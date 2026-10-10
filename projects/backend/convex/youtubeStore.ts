import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { YoutubeSubscription, YoutubeView } from "../contracts.js"
import { fail } from "./validation.ts"
import { websubConfig, YOUTUBE_LIMIT, YOUTUBE_RETENTION_MS, YOUTUBE_RETRY_MS, youtubeDeliveryContext } from "./youtubeDomain.ts"

type Read = QueryCtx | MutationCtx
export const youtubeSubscriptions = (ctx: Read, serverId: string) => ctx.db.query("youtubeSubscriptions").withIndex("by_server", q => q.eq("serverId", serverId)).take(YOUTUBE_LIMIT)
export const youtubeSubscription = (ctx: Read, serverId: string, youtubeChannelId: string) =>
    ctx.db.query("youtubeSubscriptions").withIndex("by_server", q => q.eq("serverId", serverId).eq("youtubeChannelId", youtubeChannelId)).unique()
export const youtubeSource = (ctx: Read, youtubeChannelId: string) => ctx.db.query("youtubeSources").withIndex("by_channel", q => q.eq("youtubeChannelId", youtubeChannelId)).unique()
export const youtubeDelivery = (ctx: Read, serverId: string, youtubeChannelId: string, videoId: string) =>
    ctx.db.query("youtubeDeliveries").withIndex("by_video", q => q.eq("serverId", serverId).eq("youtubeChannelId", youtubeChannelId).eq("videoId", videoId)).unique()
export const newestYoutubeVideo = (ctx: Read, youtubeChannelId: string) => ctx.db.query("youtubeVideos").withIndex("by_channel", q => q.eq("youtubeChannelId", youtubeChannelId)).order("desc").first()

export async function publicYoutubeSubscription(ctx: Read, row: Doc<"youtubeSubscriptions">): Promise<YoutubeSubscription> {
    const source = await youtubeSource(ctx, row.youtubeChannelId), video = await newestYoutubeVideo(ctx, row.youtubeChannelId)
    return { youtubeChannelId: row.youtubeChannelId, channelId: row.channelId, enabled: row.enabled, ...(row.problem ? { problem: row.problem } : {}), createdAt: row.createdAt, status: {
        ...(source?.title ? { title: source.title } : {}), ...(source?.leaseExpiresAt !== undefined ? { subscribedUntil: source.leaseExpiresAt } : {}), ...(source?.lastError ? { hubError: source.lastError } : {}),
        ...(source?.lastNotificationAt !== undefined ? { lastNotificationAt: source.lastNotificationAt } : {}), ...(row.lastPostAt !== undefined ? { lastPostAt: row.lastPostAt } : {}),
        ...(video ? { latestVideo: { videoId: video.videoId, title: video.title, publishedAt: video.publishedAt } } : {}) } }
}
export async function youtubeView(ctx: Read, serverId: string): Promise<YoutubeView> {
    return { configured: websubConfig() !== null, subscriptions: await Promise.all((await youtubeSubscriptions(ctx, serverId)).map(row => publicYoutubeSubscription(ctx, row))) }
}

// A followed channel asks YouTube's hub for a subscription at once. Before every request the lease sweep checks that a server still
// follows the channel, so a source whose last subscription was removed, or purged with its server, unsubscribes. A channel without a name
// reads its public feed once, so it is named before its first notification
export async function followYoutubeSource(ctx: MutationCtx, youtubeChannelId: string, now: number) {
    const source = await youtubeSource(ctx, youtubeChannelId)
    if (!source?.title) await ctx.scheduler.runAfter(0, internal.youtubeHub.readFeed, { youtubeChannelId })
    if (source?.mode === "subscribe") return
    if (source) await ctx.db.patch(source._id, { mode: "subscribe", dueAt: now, failures: 0, lastError: undefined })
    else await ctx.db.insert("youtubeSources", { youtubeChannelId, mode: "subscribe", dueAt: now, failures: 0, createdAt: now })
    await ctx.scheduler.runAfter(0, internal.youtubeHub.leases, {})
}
export async function unfollowYoutubeSource(ctx: MutationCtx, youtubeChannelId: string, now: number) {
    if (await ctx.db.query("youtubeSubscriptions").withIndex("by_source", q => q.eq("youtubeChannelId", youtubeChannelId)).first()) return
    const source = await youtubeSource(ctx, youtubeChannelId)
    if (source?.mode !== "subscribe") return
    await ctx.db.patch(source._id, { mode: "unsubscribe", dueAt: now, failures: 0, lastError: undefined })
    await ctx.scheduler.runAfter(0, internal.youtubeHub.leases, {})
}

/** Alerts post while publishing is on and the server is at DEFCON 3 */
export async function youtubeAutomation(ctx: Read, serverId: string) {
    const publisher = await ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    return publisher?.enabled !== false && (moderation?.config.defcon ?? 3) === 3
}

// An alert's tracked post and attempt, once nothing about them is unknown
async function releaseYoutubePost(ctx: MutationCtx, attempt: Doc<"publishingAttempts">) {
    const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo)).unique()
    if (post?.attemptId === attempt._id) await ctx.db.delete(post._id)
    await ctx.db.delete(attempt._id)
}
// The publisher reports each outcome here. An attempt that never reached Fluxer is released and the alert waits for another try,
// which the bot only makes while the alert is recent. An unknown outcome is never retried
export async function syncYoutubePublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, outcome: "sent" | "failed" | "uncertain") {
    const consumer = attempt.consumer
    if (consumer?.type !== "youtube") return
    const delivery = await ctx.db.query("youtubeDeliveries").withIndex("by_video", q => q.eq("serverId", attempt.serverId).eq("youtubeChannelId", consumer.youtubeChannelId).eq("videoId", consumer.videoId)).unique()
    if (!delivery || delivery.attemptId !== attempt._id) return
    const now = Date.now()
    if (outcome === "failed" && attempt.dispatchedAt === undefined) {
        await releaseYoutubePost(ctx, attempt)
        await ctx.db.patch(delivery._id, { state: "queued", nextCheckAt: now + YOUTUBE_RETRY_MS, postNo: undefined, attemptId: undefined })
        return
    }
    await ctx.db.patch(delivery._id, { state: outcome })
    const subscription = outcome === "sent" ? await youtubeSubscription(ctx, attempt.serverId, consumer.youtubeChannelId) : null
    if (subscription) await ctx.db.patch(subscription._id, { lastPostAt: now })
}
// The publisher's claim: The alert's subscription must still be on, with the same destination, while publishing is on at DEFCON 3.
// Otherwise the unclaimed attempt closes without a send
export async function youtubePublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "youtube") fail(409, "YouTube consumer missing")
    const delivery = await ctx.db.query("youtubeDeliveries").withIndex("by_video", q => q.eq("serverId", attempt.serverId).eq("youtubeChannelId", consumer.youtubeChannelId).eq("videoId", consumer.videoId)).unique()
    if (!delivery || delivery.attemptId !== attempt._id) fail(409, "YouTube alert changed")
    const subscription = await youtubeSubscription(ctx, attempt.serverId, consumer.youtubeChannelId), now = Date.now()
    if (!subscription?.enabled || subscription.channelId !== attempt.channelId || now >= attempt.dispatchExpiresAt || !await youtubeAutomation(ctx, attempt.serverId)) {
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now })
        await syncYoutubePublishing(ctx, (await ctx.db.get(attempt._id))!, "failed")
        return false
    }
    const context = youtubeDeliveryContext(value, now)
    if (context.botId !== attempt.botId || context.channelId !== attempt.channelId) fail(409, "YouTube alert destination changed")
    return true
}

const YOUTUBE_BATCH = 128
// Retention: Seen videos and alerts expire after 30 days. An alert's tracked post goes with it, except while its outcome is unknown
export async function cleanupYoutube(ctx: MutationCtx, now: number) {
    const videos = await ctx.db.query("youtubeVideos").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(YOUTUBE_BATCH)
    for (const row of videos) await ctx.db.delete(row._id)
    const deliveries = await ctx.db.query("youtubeDeliveries").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(YOUTUBE_BATCH)
    for (const row of deliveries) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt && (attempt.outcome === "pending" || attempt.unresolved)) { await ctx.db.patch(row._id, { expiresAt: now + YOUTUBE_RETENTION_MS }); continue }
        if (attempt) await releaseYoutubePost(ctx, attempt)
        await ctx.db.delete(row._id)
    }
    return { more: videos.length === YOUTUBE_BATCH || deliveries.length === YOUTUBE_BATCH }
}
