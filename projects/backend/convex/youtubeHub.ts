import { v } from "convex/values"
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import { isInstalled } from "./installations.ts"
import { ringWork } from "./workSignal.ts"
import { HUB_CONFIRM_MS, HUB_LEASE_MAX_SECONDS, hubBackoff, hubRenewal, hubSignatureMatches, parseYoutubeFeed, parseYoutubeNotification, websubConfig, YOUTUBE_FEED_TIMEOUT_MS, YOUTUBE_FRESH_MS,
    YOUTUBE_NOTIFICATION_BYTES, YOUTUBE_RETENTION_MS, youtubeCallback, youtubeFeedUrl, youtubeTopic, type YoutubeFeed } from "./youtubeDomain.ts"
import { youtubeSource } from "./youtubeStore.ts"
import { youtubeMode, youtubePreview } from "./youtubeValidators.ts"

// YouTube's WebSub hub. NeonFlux subscribes once per followed channel, with a secret per channel, renews each lease a day before it ends
// and unsubscribes once no server follows the channel. The hub confirms each request through the GET route in http.ts and delivers
// notifications through its POST route. Alerts come only from those notifications. The channel's public feed is read once when it is
// added, for its name and a test alert's video, and nothing polls YouTube or reads its pages

const LEASE_BATCH = 25, FAN_OUT_BATCH = 100
const followed = async (ctx: MutationCtx, youtubeChannelId: string) => !!await ctx.db.query("youtubeSubscriptions").withIndex("by_source", q => q.eq("youtubeChannelId", youtubeChannelId)).first()

// The lease sweep. The hourly cron runs it, and so do a change of followers and every failed request at its retry time. Each due source
// sends one request, after a check that a server still follows its channel. A source that no server follows unsubscribes, and one whose
// lease already ended needs no request and is deleted
export const leases = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now(), due = await ctx.db.query("youtubeSources").withIndex("by_due", q => q.lte("dueAt", now)).take(LEASE_BATCH)
    for (const row of due) {
        const mode = row.mode === "subscribe" && !await followed(ctx, row.youtubeChannelId) ? "unsubscribe" : row.mode
        if (mode === "unsubscribe" && !(row.leaseExpiresAt !== undefined && row.leaseExpiresAt > now)) { await ctx.db.delete(row._id); continue }
        // Until the hub confirms, each request counts as a failure for the backoff, and the hour it waits for the confirmation guards a lost request
        await ctx.db.patch(row._id, { mode, failures: (mode === row.mode ? row.failures : 0) + 1, requestedAt: now, dueAt: now + HUB_CONFIRM_MS })
        await ctx.scheduler.runAfter(0, internal.youtubeHub.request, { youtubeChannelId: row.youtubeChannelId, mode })
    }
    if (due.length === LEASE_BATCH) await ctx.scheduler.runAfter(0, internal.youtubeHub.leases, {})
} })

// One request to the hub. The secret is created here, where randomness is not replayed, and kept for the source's lifetime
export const request = internalAction({ args: { youtubeChannelId: v.string(), mode: youtubeMode }, handler: async (ctx, args) => {
    const config = websubConfig()
    let error: string | undefined
    if (!config) error = "The bot operator has not set up YouTube alerts"
    else {
        const secret = await ctx.runMutation(internal.youtubeHub.prepare, { ...args, secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("") })
        if (secret === null) return
        try {
            const response = await fetch(config.hubUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
                "hub.callback": youtubeCallback(config.callbackBase, args.youtubeChannelId), "hub.mode": args.mode, "hub.topic": youtubeTopic(args.youtubeChannelId), "hub.verify": "async",
                ...(args.mode === "subscribe" ? { "hub.secret": secret } : {}) }).toString() })
            if (response.status !== 202 && response.status !== 204) error = response.status >= 500 ? "YouTube's notification service had an error" : "YouTube's notification service turned down the request"
        } catch {
            error = "YouTube's notification service could not be reached"
        }
    }
    await ctx.runMutation(internal.youtubeHub.requested, { ...args, ...(error ? { error } : {}) })
} })
/** The source's secret, created once. null when the source no longer wants this request */
export const prepare = internalMutation({ args: { youtubeChannelId: v.string(), mode: youtubeMode, secret: v.string() }, handler: async (ctx, args): Promise<string | null> => {
    const row = await youtubeSource(ctx, args.youtubeChannelId)
    if (row?.mode !== args.mode) return null
    if (row.secret === undefined) await ctx.db.patch(row._id, { secret: args.secret })
    return row.secret ?? args.secret
} })
// A request the hub accepted waits for its confirmation, unless that already arrived. A failed one retries with backoff and jitter
export const requested = internalMutation({ args: { youtubeChannelId: v.string(), mode: youtubeMode, error: v.optional(v.string()) }, handler: async (ctx, args) => {
    const row = await youtubeSource(ctx, args.youtubeChannelId), now = Date.now()
    if (row?.mode !== args.mode || (row.verifiedAt ?? -1) >= (row.requestedAt ?? 0)) return
    const delay = hubBackoff(row.failures)
    if (args.error === undefined) { await ctx.db.patch(row._id, { lastError: undefined, dueAt: now + Math.max(HUB_CONFIRM_MS, delay) }); return }
    await retry(ctx, row, args.error, now)
} })
async function retry(ctx: MutationCtx, row: Doc<"youtubeSources">, error: string, now: number) {
    const dueAt = now + hubBackoff(row.failures)
    await ctx.db.patch(row._id, { lastError: error, dueAt })
    await ctx.scheduler.runAt(dueAt, internal.youtubeHub.leases, {})
}

/**
 * The hub's confirmation of a request, answered with its challenge only for a topic NeonFlux asked for in the mode it wants now. A
 * confirmed subscription records its lease and renews a day before it ends, and a confirmed unsubscription deletes the source. A
 * refusal retries with backoff
 */
export const verify = internalMutation({ args: { youtubeChannelId: v.string(), mode: v.string(), topic: v.string(), leaseSeconds: v.optional(v.string()), reason: v.optional(v.string()) },
    handler: async (ctx, args): Promise<boolean> => {
        const row = await youtubeSource(ctx, args.youtubeChannelId), now = Date.now()
        if (!row || row.requestedAt === undefined || args.topic !== youtubeTopic(args.youtubeChannelId)) return false
        if (args.mode === "denied") {
            if (row.mode !== "subscribe") return false
            await retry(ctx, row, `YouTube's notification service turned down the subscription${args.reason ? ` and said "${args.reason.slice(0, 200)}"` : ""}`, now)
            return true
        }
        if (args.mode !== row.mode) return false
        if (row.mode === "unsubscribe") { await ctx.db.delete(row._id); return true }
        const lease = Number(args.leaseSeconds)
        if (!/^\d+$/.test(args.leaseSeconds ?? "") || lease < 1 || lease > HUB_LEASE_MAX_SECONDS) return false
        await ctx.db.patch(row._id, { leaseExpiresAt: now + lease * 1000, verifiedAt: now, failures: 0, lastError: undefined, dueAt: now + hubRenewal(lease * 1000) })
        return true
    } })

export type YoutubeNotificationResult = "accepted" | "unknown" | "rejected" | "unreadable"
/**
 * A notification. One for a channel NeonFlux does not subscribe to, or without a valid signature, writes nothing. A video seen before is
 * an update and posts nothing. A new video creates one alert per subscription, unless it was published before the subscription was
 * added or more than seven days ago
 */
export const notify = internalMutation({ args: { youtubeChannelId: v.string(), signature: v.union(v.string(), v.null()), body: v.bytes() }, handler: async (ctx, args): Promise<YoutubeNotificationResult> => {
    const row = await youtubeSource(ctx, args.youtubeChannelId)
    if (row?.mode !== "subscribe" || row.secret === undefined) return "unknown"
    // A rejected notification records nothing, so a log line tells it apart from none. It never names the secret or the body
    if (!await hubSignatureMatches(row.secret, args.signature, args.body)) { console.warn(`YouTube notification for ${row.youtubeChannelId} rejected: ${args.signature ? "its signature does not match" : "it has no signature"}`); return "rejected" }
    let entries: ReturnType<typeof parseYoutubeNotification>
    try { entries = parseYoutubeNotification(new TextDecoder("utf-8", { fatal: true }).decode(args.body)) } catch { entries = undefined }
    if (entries === "deleted") return "accepted"
    if (!entries || entries.some(entry => entry.youtubeChannelId !== row.youtubeChannelId)) { console.warn(`YouTube notification for ${row.youtubeChannelId} rejected: it could not be read`); return "unreadable" }
    const now = Date.now(), channelTitle = entries.find(entry => entry.channelTitle)?.channelTitle
    await ctx.db.patch(row._id, { lastNotificationAt: now, ...(channelTitle ? { title: channelTitle } : {}) })
    let created = 0
    for (const entry of entries) {
        const seen = await ctx.db.query("youtubeVideos").withIndex("by_video", q => q.eq("videoId", entry.videoId)).unique()
        if (seen) { await ctx.db.patch(seen._id, { title: entry.title, expiresAt: now + YOUTUBE_RETENTION_MS }); continue }
        await ctx.db.insert("youtubeVideos", { videoId: entry.videoId, youtubeChannelId: entry.youtubeChannelId, title: entry.title, publishedAt: entry.publishedAt, seenAt: now, expiresAt: now + YOUTUBE_RETENTION_MS })
        if (entry.publishedAt >= now - YOUTUBE_FRESH_MS) created += await fanOut(ctx, entry.videoId, "")
    }
    if (created) await ringWork(ctx)
    return "accepted"
} })
// Alerts for a page of a new video's subscriptions, in server order. Each alert is checked and inserted in this transaction, so a
// subscription gets at most one alert per video
async function fanOut(ctx: MutationCtx, videoId: string, afterServerId: string) {
    const video = (await ctx.db.query("youtubeVideos").withIndex("by_video", q => q.eq("videoId", videoId)).unique())!, now = Date.now()
    const page = await ctx.db.query("youtubeSubscriptions").withIndex("by_source", q => q.eq("youtubeChannelId", video.youtubeChannelId).gt("serverId", afterServerId)).take(FAN_OUT_BATCH)
    let created = 0
    for (const subscription of page) {
        if (!subscription.enabled || subscription.createdAt > video.publishedAt || !await isInstalled(ctx, subscription.serverId)) continue
        const key = { serverId: subscription.serverId, youtubeChannelId: video.youtubeChannelId, videoId }
        if (await ctx.db.query("youtubeDeliveries").withIndex("by_video", q => q.eq("serverId", key.serverId).eq("youtubeChannelId", key.youtubeChannelId).eq("videoId", videoId)).unique()) continue
        await ctx.db.insert("youtubeDeliveries", { ...key, title: video.title, state: "queued", nextCheckAt: now, createdAt: now, expiresAt: now + YOUTUBE_RETENTION_MS })
        created++
    }
    if (page.length === FAN_OUT_BATCH) await ctx.scheduler.runAfter(0, internal.youtubeHub.fanOutPage, { videoId, afterServerId: page.at(-1)!.serverId })
    return created
}
export const fanOutPage = internalMutation({ args: { videoId: v.string(), afterServerId: v.string() }, handler: async (ctx, { videoId, afterServerId }) => {
    if (await fanOut(ctx, videoId, afterServerId)) await ringWork(ctx)
} })

// Up to the first max bytes of a response body. The rest is never read
async function readStart(response: Response, max: number) {
    const reader = response.body?.getReader(), bytes = new Uint8Array(max)
    let size = 0
    while (reader && size < max) {
        const { done, value } = await reader.read()
        if (done) break
        bytes.set(value.subarray(0, max - size), size)
        size += Math.min(value.byteLength, max - size)
    }
    await reader?.cancel().catch(() => undefined)
    return new TextDecoder().decode(bytes.subarray(0, size))
}
/**
 * The channel's public feed, read once when a channel without a name is added, for its name and newest upload. Only the feed's first
 * 64 KiB are read within 5 seconds. A failed read keeps the ID and is not tried again. Nothing from the feed counts as a seen video, so
 * it never starts or stops an alert
 */
export const readFeed = internalAction({ args: { youtubeChannelId: v.string() }, handler: async (ctx, { youtubeChannelId }) => {
    // The deadline covers reading the body too. A timer works in every runtime, where AbortSignal.timeout may be missing
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), YOUTUBE_FEED_TIMEOUT_MS)
    let feed: YoutubeFeed | undefined
    try {
        const response = await fetch(youtubeFeedUrl(youtubeChannelId), { signal: controller.signal })
        feed = response.ok ? parseYoutubeFeed(await readStart(response, YOUTUBE_NOTIFICATION_BYTES), youtubeChannelId) : undefined
    } catch { feed = undefined } finally { clearTimeout(timer) }
    if (feed?.title || feed?.newest) await ctx.runMutation(internal.youtubeHub.feedRead, { youtubeChannelId, ...feed })
} })
export const feedRead = internalMutation({ args: { youtubeChannelId: v.string(), title: v.optional(v.string()), newest: v.optional(youtubePreview) }, handler: async (ctx, args) => {
    const row = await youtubeSource(ctx, args.youtubeChannelId)
    if (row) await ctx.db.patch(row._id, { ...(args.title ? { title: args.title } : {}), ...(args.newest ? { preview: args.newest } : {}) })
} })
