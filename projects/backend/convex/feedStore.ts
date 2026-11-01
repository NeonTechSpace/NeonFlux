import type { Doc, Id } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { feedPendingHandle, type FeedProvider, type FeedSubscription, type FeedView } from "@neonflux/contracts/feeds"
import { fail } from "./validation.ts"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import {
    FEED_DELIVERY_RETENTION_MS,
    FEED_LIMIT,
    FEED_RETRY_MS,
    FEED_TICK_GAP_MS,
    feedDeliveryContext,
    feedSourceLimit,
} from "./feedDomain.ts"
import { xConfig, xMonthlyReads, X_POLL_READS } from "./feedX.ts"

type Read = QueryCtx | MutationCtx
export const feedSubscriptions = (ctx: Read, serverId: string) =>
    ctx.db
        .query("feedSubscriptions")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .take(FEED_LIMIT)
export const feedSubscription = (ctx: Read, serverId: string, provider: FeedProvider, accountId: string) =>
    ctx.db
        .query("feedSubscriptions")
        .withIndex("by_server", (q) => q.eq("serverId", serverId).eq("provider", provider).eq("accountId", accountId))
        .unique()
export const feedSource = (ctx: Read, provider: FeedProvider, accountId: string) =>
    ctx.db
        .query("feedSources")
        .withIndex("by_account", (q) => q.eq("provider", provider).eq("accountId", accountId))
        .unique()
export const feedDelivery = (ctx: Read, serverId: string, provider: FeedProvider, accountId: string, itemId: string) =>
    ctx.db
        .query("feedDeliveries")
        .withIndex("by_item", (q) =>
            q.eq("serverId", serverId).eq("provider", provider).eq("accountId", accountId).eq("itemId", itemId),
        )
        .unique()
export const feedItem = (ctx: Read, provider: FeedProvider, accountId: string, itemId: string) =>
    ctx.db
        .query("feedItems")
        .withIndex("by_item", (q) => q.eq("provider", provider).eq("accountId", accountId).eq("itemId", itemId))
        .unique()
/** The source a typed handle names, once a lookup or a read gave a source that handle */
export const feedSourceByHandle = (ctx: Read, provider: FeedProvider, handle: string) =>
    ctx.db
        .query("feedSources")
        .withIndex("by_handle", (q) => q.eq("provider", provider).eq("handle", handle))
        .first()
export const feedPollerRow = (ctx: Read) => ctx.db.query("feedPoller").first()
export const feedMonth = (now: number) => new Date(now).toISOString().slice(0, 7)
/** The X reads left this month. Reads count on the UTC calendar month, since X's own billing cycle is not readable */
export const xReadsLeft = (poller: Doc<"feedPoller"> | null, now: number) =>
    Math.max(xMonthlyReads() - (poller?.xMonth === feedMonth(now) ? poller.xReads : 0), 0)

export async function publicFeedSubscription(ctx: Read, row: Doc<"feedSubscriptions">): Promise<FeedSubscription> {
    const source = await feedSource(ctx, row.provider, row.accountId)
    return {
        provider: row.provider,
        accountId: row.accountId,
        channelId: row.channelId,
        enabled: row.enabled,
        ...(row.problem ? { problem: row.problem } : {}),
        createdAt: row.createdAt,
        status: {
            ...(source?.handle ? { handle: source.handle } : {}),
            ...(source?.name ? { name: source.name } : {}),
            ...(source?.stopped ? { stopped: true } : {}),
            ...(source?.lastError ? { error: source.lastError } : {}),
            ...(source?.lastReadAt !== undefined ? { lastReadAt: source.lastReadAt } : {}),
            ...(source?.lastItemAt !== undefined ? { lastItemAt: source.lastItemAt } : {}),
            ...(row.lastPostAt !== undefined ? { lastPostAt: row.lastPostAt } : {}),
        },
    }
}
export async function feedView(ctx: Read, serverId: string): Promise<FeedView> {
    return {
        xConfigured: xConfig() !== null,
        xPaused: xReadsLeft(await feedPollerRow(ctx), Date.now()) < X_POLL_READS,
        subscriptions: await Promise.all(
            (await feedSubscriptions(ctx, serverId)).map((row) => publicFeedSubscription(ctx, row)),
        ),
    }
}

/**
 * Starts the poll chain or brings its next tick forward. The chain runs only while sources exist, one tick at a time, and a generation
 * lets a replaced tick end without reading. Ticks stay a gap apart however often this runs
 */
export async function wakeFeedPoller(ctx: MutationCtx, at: number) {
    const poller = await feedPollerRow(ctx),
        when = Math.max(at, (poller?.lastTickAt ?? 0) + FEED_TICK_GAP_MS)
    if (poller?.scheduledId && poller.nextTickAt !== undefined && poller.nextTickAt <= when) return
    const generation = (poller?.generation ?? 0) + 1,
        scheduledId = await ctx.scheduler.runAt(when, internal.feedPolling.tick, { generation })
    if (poller?.scheduledId) await cancelTick(ctx, poller.scheduledId)
    if (poller) await ctx.db.patch(poller._id, { generation, scheduledId, nextTickAt: when })
    else
        await ctx.db.insert("feedPoller", {
            generation,
            scheduledId,
            nextTickAt: when,
            sourceCount: 0,
            xMonth: feedMonth(at),
            xReads: 0,
        })
}
const cancelTick = async (ctx: MutationCtx, id: Id<"_scheduled_functions">) => {
    const job = await ctx.db.system.get(id)
    if (job?.state.kind === "pending") await ctx.scheduler.cancel(id)
}
export async function countFeedSources(ctx: MutationCtx, change: number) {
    const poller = await feedPollerRow(ctx)
    if (poller) await ctx.db.patch(poller._id, { sourceCount: Math.max(poller.sourceCount + change, 0) })
}
/** Adds the source a follow needs. It waits for its lookup, or for its first read when the account is already known by its ID */
export async function followFeedSource(ctx: MutationCtx, provider: FeedProvider, accountId: string, now: number) {
    const source = await feedSource(ctx, provider, accountId)
    if (source && !source.stopped && !source.idle) return
    if (source)
        await ctx.db.patch(source._id, {
            stopped: false,
            idle: undefined,
            lastError: undefined,
            failures: 0,
            dueAt: now,
        })
    else {
        if (((await feedPollerRow(ctx))?.sourceCount ?? 0) >= feedSourceLimit())
            fail(507, "NeonFlux follows as many accounts as it can right now. Try again later")
        const handle = feedPendingHandle(accountId)
        await ctx.db.insert("feedSources", {
            provider,
            accountId,
            ...(handle ? { handle } : {}),
            dueAt: now,
            failures: 0,
            createdAt: now,
        })
    }
    await wakeFeedPoller(ctx, now)
    if (!source) await countFeedSources(ctx, 1)
}
/** The last follow leaving removes the source, so nothing reads an account no server wants */
export async function unfollowFeedSource(ctx: MutationCtx, provider: FeedProvider, accountId: string) {
    if (
        await ctx.db
            .query("feedSubscriptions")
            .withIndex("by_source", (q) => q.eq("provider", provider).eq("accountId", accountId))
            .first()
    )
        return
    const source = await feedSource(ctx, provider, accountId)
    if (!source) return
    await ctx.db.delete(source._id)
    await countFeedSources(ctx, -1)
}

/** Posts go out while publishing is on and the server is at DEFCON 3 */
export async function feedAutomation(ctx: Read, serverId: string) {
    return (await publisherSettings(ctx, serverId))?.enabled !== false && !(await defconHoldsAutomation(ctx, serverId))
}

// A post's tracked post and attempt, once nothing about them is unknown
async function releaseFeedPost(ctx: MutationCtx, attempt: Doc<"publishingAttempts">) {
    const post = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo))
        .unique()
    if (post?.attemptId === attempt._id) await ctx.db.delete(post._id)
    await ctx.db.delete(attempt._id)
}
// The publisher reports each outcome here. An attempt that never reached Fluxer is released and the post waits for another try,
// which the bot only makes while the post is recent. An unknown outcome is never retried
export async function syncFeedPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    const consumer = attempt.consumer
    if (consumer?.type !== "feed") return
    const delivery = await feedDelivery(ctx, attempt.serverId, consumer.provider, consumer.accountId, consumer.itemId)
    if (!delivery || delivery.attemptId !== attempt._id) return
    const now = Date.now()
    if (outcome === "failed" && attempt.dispatchedAt === undefined) {
        await releaseFeedPost(ctx, attempt)
        await ctx.db.patch(delivery._id, {
            state: "queued",
            nextCheckAt: now + FEED_RETRY_MS,
            postNo: undefined,
            attemptId: undefined,
        })
        return
    }
    await ctx.db.patch(delivery._id, { state: outcome })
    const subscription =
        outcome === "sent" ? await feedSubscription(ctx, attempt.serverId, consumer.provider, consumer.accountId) : null
    if (subscription) await ctx.db.patch(subscription._id, { lastPostAt: now })
}
// The publisher's claim: The post's follow must still be on, with the same destination, while publishing is on at DEFCON 3.
// Otherwise the unclaimed attempt closes without a send
export async function feedPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "feed") fail(409, "Feed consumer missing")
    const delivery = await feedDelivery(ctx, attempt.serverId, consumer.provider, consumer.accountId, consumer.itemId)
    if (!delivery || delivery.attemptId !== attempt._id) fail(409, "Feed post changed")
    const subscription = await feedSubscription(ctx, attempt.serverId, consumer.provider, consumer.accountId),
        now = Date.now()
    if (
        !subscription?.enabled ||
        subscription.channelId !== attempt.channelId ||
        subscription.createdAt > delivery.publishedAt ||
        now >= attempt.dispatchExpiresAt ||
        !(await feedAutomation(ctx, attempt.serverId))
    ) {
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now })
        await syncFeedPublishing(ctx, (await ctx.db.get(attempt._id))!, "failed")
        return false
    }
    const context = feedDeliveryContext(value, now)
    if (context.botId !== attempt.botId || context.channelId !== attempt.channelId)
        fail(409, "Feed post destination changed")
    return true
}

const FEED_BATCH = 128,
    FEED_CHAIN_LOST_MS = 600000
// Retention: Seen posts expire after a week and posts sent to servers after 30 days. A delivery's tracked post goes with it, except while its outcome is unknown
export async function cleanupFeeds(ctx: MutationCtx, now: number) {
    // A scheduled action runs at most once, so one lost before it scheduled its successor would end the chain for good. This pass restarts it
    const poller = await feedPollerRow(ctx)
    if (poller?.scheduledId && (poller.nextTickAt ?? now) < now - FEED_CHAIN_LOST_MS) {
        await ctx.db.patch(poller._id, { scheduledId: undefined, nextTickAt: undefined })
        await wakeFeedPoller(ctx, now)
    }
    const items = await ctx.db
        .query("feedItems")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(FEED_BATCH)
    for (const row of items) await ctx.db.delete(row._id)
    const deliveries = await ctx.db
        .query("feedDeliveries")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(FEED_BATCH)
    for (const row of deliveries) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt && (attempt.outcome === "pending" || attempt.unresolved)) {
            await ctx.db.patch(row._id, { expiresAt: now + FEED_DELIVERY_RETENTION_MS })
            continue
        }
        if (attempt) await releaseFeedPost(ctx, attempt)
        await ctx.db.delete(row._id)
    }
    return { more: items.length === FEED_BATCH || deliveries.length === FEED_BATCH }
}
