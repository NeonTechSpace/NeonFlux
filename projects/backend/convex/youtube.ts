import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server.js"
import type { PublishingYoutubeConsumer } from "@neonflux/contracts/publishing-base"
import { YOUTUBE_WORK_BATCH, YoutubeManageRequest, YoutubeQueryRequest, YoutubeWorkRequest, type YoutubeManageResult, type YoutubeOperation, type YoutubeQueryResult, type YoutubeWorkResult } from "@neonflux/contracts/youtube"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { actor } from "./moderationDomain.ts"
import { reservePublishing } from "./publishing.ts"
import { decode, fail, requireServer, source } from "./validation.ts"
import { renderYoutubeAlert, websubConfig, YOUTUBE_ALERT_WINDOW_MS, YOUTUBE_LIMIT, YOUTUBE_RETRY_MS, youtubeDeliveryContext } from "./youtubeDomain.ts"
import { followYoutubeSource, newestYoutubeVideo, publicYoutubeSubscription, unfollowYoutubeSource, youtubeAutomation, youtubeDelivery, youtubeSource, youtubeSubscription, youtubeSubscriptions, youtubeView } from "./youtubeStore.ts"

// Chat changes. The bot vouches for a server manager's fresh native authority, like sticky messages
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<YoutubeManageResult> => {
    const input = decode(YoutubeManageRequest, request)
    const identity = source(input, Date.now()), who = actor(input.actor), op = input.operation
    if (!who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    return changeConfiguration(ctx, identity.serverId, "youtube", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applyYoutubeManagement(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, op))
} })

// Chat and dashboard share these rules. Adding a channel posts nothing for videos published before it: Only later uploads are announced
export async function applyYoutubeManagement(ctx: MutationCtx, identity: ConfigurationIdentity, op: YoutubeOperation): Promise<YoutubeManageResult> {
    const { serverId } = identity, row = await youtubeSubscription(ctx, serverId, op.youtubeChannelId), now = Date.now()
    if (op.type === "remove") {
        if (!row) fail(404, "This server does not follow that YouTube channel")
        const subscription = await publicYoutubeSubscription(ctx, row)
        await ctx.db.delete(row._id)
        await unfollowYoutubeSource(ctx, op.youtubeChannelId, now)
        return { type: "removed", subscription }
    }
    if (!websubConfig()) fail(503, "YouTube alerts are not configured")
    if (row) await ctx.db.patch(row._id, { channelId: op.channelId, enabled: true, problem: undefined, updatedAt: now, updatedBy: identity.actorId })
    else {
        if ((await youtubeSubscriptions(ctx, serverId)).length >= YOUTUBE_LIMIT) fail(429, `A server can follow at most ${YOUTUBE_LIMIT} YouTube channels`)
        await ctx.db.insert("youtubeSubscriptions", { serverId, youtubeChannelId: op.youtubeChannelId, channelId: op.channelId, enabled: true, createdAt: now, updatedAt: now, updatedBy: identity.actorId })
    }
    await followYoutubeSource(ctx, op.youtubeChannelId, now)
    return { type: "added", subscription: await publicYoutubeSubscription(ctx, (await youtubeSubscription(ctx, serverId, op.youtubeChannelId))!) }
}

// What !youtube status shows. sample also builds a test alert for one followed channel, labelled as a test
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<YoutubeQueryResult> => {
    const { serverId, sample } = decode(YoutubeQueryRequest, request), view = await youtubeView(ctx, serverId)
    if (sample === undefined) return view
    const row = await youtubeSubscription(ctx, serverId, sample)
    if (!row) fail(404, "This server does not follow that YouTube channel")
    // The newest upload a notification or the public feed named. The feed's is only ever a test's
    const video = await newestYoutubeVideo(ctx, row.youtubeChannelId), source = await youtubeSource(ctx, row.youtubeChannelId)
    const newest = video && source?.preview ? (video.publishedAt >= source.preview.publishedAt ? video : source.preview) : video ?? source?.preview
    return { ...view, sample: { channelId: row.channelId, ...renderYoutubeAlert(row.youtubeChannelId, newest, source?.title, true) } }
} })

// The bot's alert worker: Due alerts, their reservation for the publisher, a wait after a failed read and a subscription NeonFlux turns off
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<YoutubeWorkResult> => {
    const { serverId, operation: op } = decode(YoutubeWorkRequest, request)
    requireServer(serverId)
    const now = Date.now()
    if (op.type === "list") {
        if (!await youtubeAutomation(ctx, serverId)) return { type: "deliveries", deliveries: [] }
        const due = await ctx.db.query("youtubeDeliveries").withIndex("by_server_due", q => q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now)).take(YOUTUBE_WORK_BATCH)
        const deliveries = []
        for (const row of due) {
            const subscription = await youtubeSubscription(ctx, serverId, row.youtubeChannelId)
            if (!subscription?.enabled || now - row.createdAt >= YOUTUBE_ALERT_WINDOW_MS) await ctx.db.patch(row._id, { state: "skipped" })
            else deliveries.push({ youtubeChannelId: row.youtubeChannelId, videoId: row.videoId, channelId: subscription.channelId })
        }
        return { type: "deliveries", deliveries }
    }
    if (op.type === "blocked") {
        const row = await youtubeSubscription(ctx, serverId, op.youtubeChannelId)
        // A report about a destination that changed since the bot read it changes nothing
        if (!row?.enabled || row.channelId !== op.channelId) return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { enabled: false, problem: op.reason, updatedAt: now })
        const title = (await youtubeSource(ctx, row.youtubeChannelId))?.title
        return { type: "progress", recorded: true, ...(title ? { title } : {}) }
    }
    const row = await youtubeDelivery(ctx, serverId, op.youtubeChannelId, op.videoId)
    if (!row) fail(404, "YouTube alert not found")
    if (op.type === "defer") {
        if (row.state !== "queued") return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { nextCheckAt: now + YOUTUBE_RETRY_MS })
        return { type: "progress", recorded: true }
    }
    const context = youtubeDeliveryContext(op.context, now)
    if (row.state !== "queued") fail(409, "YouTube alert already handled")
    if (!await youtubeAutomation(ctx, serverId)) fail(403, "YouTube alerts paused")
    const subscription = await youtubeSubscription(ctx, serverId, row.youtubeChannelId)
    if (!subscription?.enabled || now - row.createdAt >= YOUTUBE_ALERT_WINDOW_MS) {
        await ctx.db.patch(row._id, { state: "skipped" })
        return { type: "skipped" }
    }
    if (context.channelId !== subscription.channelId) fail(409, "YouTube alert destination changed")
    const alert = renderYoutubeAlert(row.youtubeChannelId, row, (await youtubeSource(ctx, row.youtubeChannelId))?.title)
    const consumer: PublishingYoutubeConsumer = { type: "youtube", youtubeChannelId: row.youtubeChannelId, videoId: row.videoId }
    const reserved = await reservePublishing(ctx, { serverId, actorId: context.botId, botId: context.botId, channelId: subscription.channelId, sourceId: `youtube_${row.youtubeChannelId}_${row.videoId}`,
        source: consumer, provenance: consumer, consumer, content: alert.content,
        // In a forum the alert becomes the first message of its own post
        forumPostName: alert.forumPostName })
    await ctx.db.patch(row._id, { state: "reserved", postNo: reserved.post.postNo, attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)! })
    return { type: "reserved", grant: reserved.grant }
} })
