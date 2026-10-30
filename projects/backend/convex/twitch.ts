import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server.js"
import type { PublishingTwitchConsumer } from "@neonflux/contracts/publishing-base"
import {
    TWITCH_WORK_BATCH,
    TwitchManageRequest,
    TwitchQueryRequest,
    TwitchWorkRequest,
    type TwitchManageResult,
    type TwitchOperation,
    type TwitchQueryResult,
    type TwitchWorkResult,
} from "@neonflux/contracts/twitch"
import { changeConfiguration } from "./configurationChange.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { actor } from "./moderationDomain.ts"
import { reservePublishing } from "./publishing.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"
import {
    renderTwitchAlert,
    twitchConfig,
    TWITCH_ALERT_WINDOW_MS,
    TWITCH_LIMIT,
    TWITCH_RETRY_MS,
    twitchDeliveryContext,
} from "./twitchDomain.ts"
import {
    followTwitchSource,
    newestTwitchStream,
    publicTwitchSubscription,
    unfollowTwitchSource,
    twitchAutomation,
    twitchDelivery,
    twitchSource,
    twitchSubscription,
    twitchSubscriptions,
    twitchView,
} from "./twitchStore.ts"

// Chat changes. The bot vouches for a server manager's fresh native authority, like sticky messages
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TwitchManageResult> => {
        const input = decode(TwitchManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "twitch",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () =>
                applyTwitchManagement(
                    ctx,
                    {
                        serverId: identity.serverId,
                        actorId: who.userId,
                        createdAt: identity.createdAt,
                        source: { kind: "chat", messageId: identity.messageId },
                    },
                    op,
                ),
        )
    },
})

// Chat and dashboard share these rules. Adding a channel posts nothing for streams started before it: Only later live streams are announced
export async function applyTwitchManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    op: TwitchOperation,
): Promise<TwitchManageResult> {
    const { serverId } = identity
    const named = await ctx.db
        .query("twitchSources")
        .withIndex("by_login", (q) => q.eq("login", op.twitchChannelId.replace(/^pending:/, "")))
        .first()
    if (named && (await twitchSubscription(ctx, serverId, named.twitchChannelId)))
        op = { ...op, twitchChannelId: named.twitchChannelId }
    const row = await twitchSubscription(ctx, serverId, op.twitchChannelId),
        now = Date.now()
    if (op.type === "remove") {
        if (!row) fail(404, "This server does not follow that Twitch channel")
        const subscription = await publicTwitchSubscription(ctx, row)
        await ctx.db.delete(row._id)
        await unfollowTwitchSource(ctx, op.twitchChannelId, now)
        return { type: "removed", subscription }
    }
    if (!twitchConfig()) fail(503, "Twitch alerts are not configured")
    if (row)
        await ctx.db.patch(row._id, {
            channelId: op.channelId,
            enabled: true,
            problem: undefined,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
    else {
        if ((await twitchSubscriptions(ctx, serverId)).length >= TWITCH_LIMIT)
            fail(429, `A server can follow at most ${TWITCH_LIMIT} Twitch channels`)
        await ctx.db.insert("twitchSubscriptions", {
            serverId,
            twitchChannelId: op.twitchChannelId,
            channelId: op.channelId,
            enabled: true,
            createdAt: now,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
    }
    await followTwitchSource(ctx, op.twitchChannelId, now)
    return {
        type: "added",
        subscription: await publicTwitchSubscription(
            ctx,
            (await twitchSubscription(ctx, serverId, op.twitchChannelId))!,
        ),
    }
}

// What !twitch status shows. sample also builds a test alert for one followed channel, labelled as a test
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TwitchQueryResult> => {
        const { serverId, sample } = decode(TwitchQueryRequest, request),
            view = await twitchView(ctx, serverId)
        if (sample === undefined) return view
        const named = await ctx.db
            .query("twitchSources")
            .withIndex("by_login", (q) => q.eq("login", sample.replace(/^pending:/, "")))
            .first()
        const row = await twitchSubscription(ctx, serverId, named?.twitchChannelId ?? sample)
        if (!row) fail(404, "This server does not follow that Twitch channel")
        // Test alerts use only the latest stream seen in EventSub, or a placeholder
        const source = await twitchSource(ctx, row.twitchChannelId),
            newest = await newestTwitchStream(ctx, source, row.twitchChannelId)
        return {
            ...view,
            sample: {
                channelId: row.channelId,
                ...renderTwitchAlert(source?.login ?? row.twitchChannelId, newest ?? undefined, source?.title, true),
            },
        }
    },
})

// The bot's alert worker: Due alerts, their reservation for the publisher, a wait after a failed read and a subscription NeonFlux turns off
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<TwitchWorkResult> => {
        const { serverId, operation: op } = decode(TwitchWorkRequest, request)
        const now = Date.now()
        if (op.type === "list") {
            if (!(await twitchAutomation(ctx, serverId))) return { type: "deliveries", deliveries: [] }
            const due = await ctx.db
                .query("twitchDeliveries")
                .withIndex("by_server_due", (q) =>
                    q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now),
                )
                .take(TWITCH_WORK_BATCH)
            const deliveries = []
            for (const row of due) {
                const subscription = await twitchSubscription(ctx, serverId, row.twitchChannelId)
                if (!subscription?.enabled || now - row.createdAt >= TWITCH_ALERT_WINDOW_MS)
                    await ctx.db.patch(row._id, { state: "skipped" })
                else
                    deliveries.push({
                        twitchChannelId: row.twitchChannelId,
                        streamId: row.streamId,
                        channelId: subscription.channelId,
                    })
            }
            return { type: "deliveries", deliveries }
        }
        if (op.type === "blocked") {
            const row = await twitchSubscription(ctx, serverId, op.twitchChannelId)
            // A report about a destination that changed since the bot read it changes nothing
            if (!row?.enabled || row.channelId !== op.channelId) return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, { enabled: false, problem: op.reason, updatedAt: now })
            const title = (await twitchSource(ctx, row.twitchChannelId))?.title
            return { type: "progress", recorded: true, ...(title ? { title } : {}) }
        }
        const row = await twitchDelivery(ctx, serverId, op.twitchChannelId, op.streamId)
        if (!row) fail(404, "Twitch alert not found")
        if (op.type === "defer") {
            if (row.state !== "queued") return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, { nextCheckAt: now + TWITCH_RETRY_MS })
            return { type: "progress", recorded: true }
        }
        const context = twitchDeliveryContext(op.context, now)
        if (row.state !== "queued") fail(409, "Twitch alert already handled")
        if (!(await twitchAutomation(ctx, serverId))) fail(403, "Twitch alerts paused")
        const subscription = await twitchSubscription(ctx, serverId, row.twitchChannelId)
        if (!subscription?.enabled || now - row.createdAt >= TWITCH_ALERT_WINDOW_MS) {
            await ctx.db.patch(row._id, { state: "skipped" })
            return { type: "skipped" }
        }
        if (context.channelId !== subscription.channelId) fail(409, "Twitch alert destination changed")
        const alert = renderTwitchAlert(
            (await twitchSource(ctx, row.twitchChannelId))?.login ?? row.twitchChannelId,
            row,
            (await twitchSource(ctx, row.twitchChannelId))?.title,
        )
        const consumer: PublishingTwitchConsumer = {
            type: "twitch",
            twitchChannelId: row.twitchChannelId,
            streamId: row.streamId,
        }
        const reserved = await reservePublishing(ctx, {
            serverId,
            actorId: context.botId,
            botId: context.botId,
            channelId: subscription.channelId,
            sourceId: `twitch_${row.twitchChannelId}_${row.streamId}`,
            source: consumer,
            provenance: consumer,
            consumer,
            content: alert.content,
            // In a forum the alert becomes the first message of its own post
            forumPostName: alert.forumPostName,
        })
        await ctx.db.patch(row._id, {
            state: "reserved",
            postNo: reserved.post.postNo,
            attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
        })
        return { type: "reserved", grant: reserved.grant }
    },
})
