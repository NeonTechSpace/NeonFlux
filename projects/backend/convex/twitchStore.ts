import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { TwitchSubscription, TwitchView } from "@neonflux/contracts/twitch"
import { fail } from "./validation.ts"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import {
    twitchConfig,
    TWITCH_LIMIT,
    TWITCH_RETENTION_MS,
    TWITCH_RETRY_MS,
    twitchDeliveryContext,
} from "./twitchDomain.ts"

type Read = QueryCtx | MutationCtx
export const twitchSubscriptions = (ctx: Read, serverId: string) =>
    ctx.db
        .query("twitchSubscriptions")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .take(TWITCH_LIMIT)
export const twitchSubscription = (ctx: Read, serverId: string, twitchChannelId: string) =>
    ctx.db
        .query("twitchSubscriptions")
        .withIndex("by_server", (q) => q.eq("serverId", serverId).eq("twitchChannelId", twitchChannelId))
        .unique()
export const twitchSource = (ctx: Read, twitchChannelId: string) =>
    ctx.db
        .query("twitchSources")
        .withIndex("by_channel", (q) => q.eq("twitchChannelId", twitchChannelId))
        .unique()
export const twitchDelivery = (ctx: Read, serverId: string, twitchChannelId: string, streamId: string) =>
    ctx.db
        .query("twitchDeliveries")
        .withIndex("by_stream", (q) =>
            q.eq("serverId", serverId).eq("twitchChannelId", twitchChannelId).eq("streamId", streamId),
        )
        .unique()
/** The latest stream seen in EventSub, never a read used to discover alerts */
export const newestTwitchStream = (ctx: Read, _source: Doc<"twitchSources"> | null, twitchChannelId: string) =>
    ctx.db
        .query("twitchStreams")
        .withIndex("by_channel", (q) => q.eq("twitchChannelId", twitchChannelId))
        .order("desc")
        .first()

export async function publicTwitchSubscription(
    ctx: Read,
    row: Doc<"twitchSubscriptions">,
): Promise<TwitchSubscription> {
    const source = await twitchSource(ctx, row.twitchChannelId),
        stream = await newestTwitchStream(ctx, source, row.twitchChannelId)
    return {
        twitchChannelId: row.twitchChannelId,
        channelId: row.channelId,
        enabled: row.enabled,
        ...(row.problem ? { problem: row.problem } : {}),
        createdAt: row.createdAt,
        status: {
            ...(source?.title ? { title: source.title } : {}),
            ...(source?.login ? { login: source.login } : {}),
            connected: source?.verifiedAt !== undefined,
            retrying: !source?.stopped,
            ...(source?.lastError ? { hubError: source.lastError } : {}),
            ...(source?.lastNotificationAt !== undefined ? { lastNotificationAt: source.lastNotificationAt } : {}),
            ...(row.lastPostAt !== undefined ? { lastPostAt: row.lastPostAt } : {}),
            ...(stream
                ? {
                      latestStream: {
                          streamId: stream.streamId,
                          title: stream.title,
                          publishedAt: stream.publishedAt,
                          ...(stream.game ? { game: stream.game } : {}),
                          ...(stream.thumbnail ? { thumbnail: stream.thumbnail } : {}),
                      },
                  }
                : {}),
        },
    }
}
export async function twitchView(ctx: Read, serverId: string): Promise<TwitchView> {
    return {
        configured: twitchConfig() !== null,
        subscriptions: await Promise.all(
            (await twitchSubscriptions(ctx, serverId)).map((row) => publicTwitchSubscription(ctx, row)),
        ),
    }
}

// Unresolved logins become numeric broadcaster IDs in the scheduled EventSub action
export async function followTwitchSource(ctx: MutationCtx, twitchChannelId: string, now: number) {
    const source = await twitchSource(ctx, twitchChannelId)
    if (source?.mode === "subscribe" && !source.stopped) return
    if (source)
        await ctx.db.patch(source._id, {
            mode: "subscribe",
            dueAt: now,
            failures: 0,
            lastError: undefined,
            stopped: false,
        })
    else
        await ctx.db.insert("twitchSources", {
            twitchChannelId,
            ...(twitchChannelId.startsWith("pending:") ? { login: twitchChannelId.slice(8) } : {}),
            mode: "subscribe",
            dueAt: now,
            failures: 0,
            createdAt: now,
        })
    await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
}
export async function unfollowTwitchSource(ctx: MutationCtx, twitchChannelId: string, now: number) {
    if (
        await ctx.db
            .query("twitchSubscriptions")
            .withIndex("by_source", (q) => q.eq("twitchChannelId", twitchChannelId))
            .first()
    )
        return
    const source = await twitchSource(ctx, twitchChannelId)
    if (!source) return
    await ctx.db.patch(source._id, { mode: "unsubscribe", dueAt: now, failures: 0, stopped: false })
    await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
}

/** Alerts post while publishing is on and the server is at DEFCON 3 */
export async function twitchAutomation(ctx: Read, serverId: string) {
    return (await publisherSettings(ctx, serverId))?.enabled !== false && !(await defconHoldsAutomation(ctx, serverId))
}

// An alert's tracked post and attempt, once nothing about them is unknown
async function releaseTwitchPost(ctx: MutationCtx, attempt: Doc<"publishingAttempts">) {
    const post = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo))
        .unique()
    if (post?.attemptId === attempt._id) await ctx.db.delete(post._id)
    await ctx.db.delete(attempt._id)
}
// The publisher reports each outcome here. An attempt that never reached Fluxer is released and the alert waits for another try,
// which the bot only makes while the alert is recent. An unknown outcome is never retried
export async function syncTwitchPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    const consumer = attempt.consumer
    if (consumer?.type !== "twitch") return
    const delivery = await ctx.db
        .query("twitchDeliveries")
        .withIndex("by_stream", (q) =>
            q
                .eq("serverId", attempt.serverId)
                .eq("twitchChannelId", consumer.twitchChannelId)
                .eq("streamId", consumer.streamId),
        )
        .unique()
    if (!delivery || delivery.attemptId !== attempt._id) return
    const now = Date.now()
    if (outcome === "failed" && attempt.dispatchedAt === undefined) {
        await releaseTwitchPost(ctx, attempt)
        await ctx.db.patch(delivery._id, {
            state: "queued",
            nextCheckAt: now + TWITCH_RETRY_MS,
            postNo: undefined,
            attemptId: undefined,
        })
        return
    }
    await ctx.db.patch(delivery._id, { state: outcome })
    const subscription =
        outcome === "sent" ? await twitchSubscription(ctx, attempt.serverId, consumer.twitchChannelId) : null
    if (subscription) await ctx.db.patch(subscription._id, { lastPostAt: now })
}
// The publisher's claim: The alert's subscription must still be on, with the same destination, while publishing is on at DEFCON 3.
// Otherwise the unclaimed attempt closes without a send
export async function twitchPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "twitch") fail(409, "Twitch consumer missing")
    const delivery = await ctx.db
        .query("twitchDeliveries")
        .withIndex("by_stream", (q) =>
            q
                .eq("serverId", attempt.serverId)
                .eq("twitchChannelId", consumer.twitchChannelId)
                .eq("streamId", consumer.streamId),
        )
        .unique()
    if (!delivery || delivery.attemptId !== attempt._id) fail(409, "Twitch alert changed")
    const subscription = await twitchSubscription(ctx, attempt.serverId, consumer.twitchChannelId),
        now = Date.now()
    if (
        !subscription?.enabled ||
        subscription.channelId !== attempt.channelId ||
        now >= attempt.dispatchExpiresAt ||
        !(await twitchAutomation(ctx, attempt.serverId))
    ) {
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now })
        await syncTwitchPublishing(ctx, (await ctx.db.get(attempt._id))!, "failed")
        return false
    }
    const context = twitchDeliveryContext(value, now)
    if (context.botId !== attempt.botId || context.channelId !== attempt.channelId)
        fail(409, "Twitch alert destination changed")
    return true
}

const TWITCH_BATCH = 128
// Retention: Seen streams and alerts expire after 30 days. An alert's tracked post goes with it, except while its outcome is unknown
export async function cleanupTwitch(ctx: MutationCtx, now: number) {
    const streams = await ctx.db
        .query("twitchStreams")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(TWITCH_BATCH)
    for (const row of streams) await ctx.db.delete(row._id)
    const deliveries = await ctx.db
        .query("twitchDeliveries")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(TWITCH_BATCH)
    for (const row of deliveries) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt && (attempt.outcome === "pending" || attempt.unresolved)) {
            await ctx.db.patch(row._id, { expiresAt: now + TWITCH_RETENTION_MS })
            continue
        }
        if (attempt) await releaseTwitchPost(ctx, attempt)
        await ctx.db.delete(row._id)
    }
    return { more: streams.length === TWITCH_BATCH || deliveries.length === TWITCH_BATCH }
}
