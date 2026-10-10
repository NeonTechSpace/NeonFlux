import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { YoutubeDeliveryContext, YoutubeOperation } from "@neonflux/contracts/youtube"
import { neutralMentions } from "./memberContent.ts"
import { publishingContent } from "./publishingDomain.ts"
import { decode, fail } from "./validation.ts"

// YouTube upload alerts come only from YouTube's WebSub notifications, without an API key, so livestreams, premieres and Shorts arrive
// as ordinary new videos. The channel's public feed is read once when it is added, for its name and a test alert's video, and nothing is
// polled or scraped. See youtubeHub.ts for the hub and the feed read and youtube.ts for subscriptions and alerts
export { YOUTUBE_LIMIT } from "@neonflux/contracts/youtube"
/** An alert the bot could not post within a day is dropped, so a long outage or lockdown posts no stale alerts */
export const YOUTUBE_ALERT_WINDOW_MS = 86400000
/** A video published longer ago than this is recorded but never announced, so an update to an old video posts nothing */
export const YOUTUBE_FRESH_MS = 7 * 86400000
/** Seen videos, alerts and their tracked posts are kept this long, and an alert with an unknown outcome until it is resolved */
export const YOUTUBE_RETENTION_MS = 30 * 86400000
/** How long an alert waits after a failed read or an attempt that never reached Fluxer */
export const YOUTUBE_RETRY_MS = 60000
/** Hub requests back off from one minute to six hours. A request the hub accepted waits an hour for its confirmation */
export const HUB_RETRY_MS = 60000, HUB_RETRY_MAX_MS = 6 * 3600000, HUB_CONFIRM_MS = 3600000
/** Leases longer than this are refused as malformed */
export const HUB_LEASE_MAX_SECONDS = 30 * 86400
/** The largest notification body NeonFlux reads */
export const YOUTUBE_NOTIFICATION_BYTES = 65536
const YOUTUBE_RED = 0xff0000

export const youtubeChannelPattern = /^UC[A-Za-z0-9_-]{22}$/
const videoPattern = /^[A-Za-z0-9_-]{11}$/
// Dashboard jobs carry the same operation as chat
export const youtubeOperation = (value: unknown): YoutubeOperation => decode(YoutubeOperation, value)
/** The bot's read of an alert's destination, taken within the last minute */
export function youtubeDeliveryContext(value: unknown, now = Date.now()): YoutubeDeliveryContext {
    const context = decode(YoutubeDeliveryContext, value)
    if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
    return context
}

/** The hub NeonFlux subscribes at and the public base of this deployment's HTTP actions, from the deployment's environment */
export function websubConfig(): { hubUrl: string, callbackBase: string } | null {
    const read = (value: string | undefined) => {
        try {
            const url = new URL(value ?? "")
            return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url : null
        } catch { return null }
    }
    const hub = read(process.env.NEONFLUX_WEBSUB_HUB_URL), callback = read(process.env.NEONFLUX_WEBSUB_CALLBACK_BASE)
    return hub && callback ? { hubUrl: hub.href, callbackBase: callback.href.replace(/\/+$/, "") } : null
}
export const YOUTUBE_CALLBACK_PATH = "/websub/youtube"
export const youtubeTopic = (youtubeChannelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${youtubeChannelId}`
export const youtubeCallback = (base: string, youtubeChannelId: string) => `${base}${YOUTUBE_CALLBACK_PATH}?channel=${youtubeChannelId}`
// watch?v= links, since Fluxer does not recognise /live/ links
export const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`
export const youtubeChannelUrl = (youtubeChannelId: string) => `https://www.youtube.com/channel/${youtubeChannelId}`

/** Exponential backoff with equal jitter: Half the delay for the failures so far, plus a random share of the other half */
export function hubBackoff(failures: number, random = Math.random()) {
    const delay = Math.min(HUB_RETRY_MS * 2 ** Math.min(Math.max(failures - 1, 0), 30), HUB_RETRY_MAX_MS)
    return Math.round(delay / 2 + random * delay / 2)
}
/** A lease is renewed a day before it ends, or halfway through a lease shorter than two days */
export const hubRenewal = (leaseMs: number) => Math.max(Math.round(leaseMs / 2), leaseMs - 86400000)

/** Whether X-Hub-Signature holds the HMAC of the body under the source's secret, compared in constant time */
export async function hubSignatureMatches(secret: string, header: string | null, body: ArrayBuffer) {
    const match = /^(sha1|sha256|sha384|sha512)=([0-9a-f]+)$/.exec(header?.trim().toLowerCase() ?? "")
    if (!match) return false
    const hash = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[match[1] as "sha1"]
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash }, false, ["sign"])
    const expected = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)), byte => byte.toString(16).padStart(2, "0")).join(""), given = match[2]!
    let difference = expected.length ^ given.length
    for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ (given.charCodeAt(index) || 0)
    return difference === 0
}

export type YoutubeEntry = { videoId: string, youtubeChannelId: string, title: string, channelTitle?: string, publishedAt: number, updatedAt: number }
const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }
// Element text with XML's predefined and numeric character references, or a CDATA section. Anything else is unreadable
function xmlText(raw: string): string | undefined {
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw)
    if (cdata) return cdata[1]
    if (raw.includes("<") || /&(?!(?:#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);)/.test(raw)) return undefined
    let valid = true
    const text = raw.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, name: string) => {
        if (!name.startsWith("#")) return entities[name]!
        const code = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        if (!(code > 0 && code <= 0x10ffff)) { valid = false; return "" }
        return String.fromCodePoint(code)
    })
    return valid ? text : undefined
}
// The text of the one element with this exact name
function element(body: string, name: string) {
    const found = [...body.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))]
    return found.length === 1 ? xmlText(found[0]![1]!) : undefined
}
function time(value: string | undefined) {
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(value?.trim() ?? "")
    const at = match ? Date.parse(`${match[1]}${match[2]?.slice(0, 4) ?? ""}${match[3]}`) : NaN
    return Number.isFinite(at) ? at : undefined
}
/**
 * The entries of a notification, read strictly: Each needs its video ID, channel ID, title and published and updated times. A
 * notification that only deletes videos answers "deleted". An empty or unreadable one answers undefined, which never means no news
 */
export function parseYoutubeNotification(xml: string): YoutubeEntry[] | "deleted" | undefined {
    if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<feed[\s>]/.test(xml) || !/<\/feed>\s*$/.test(xml)) return undefined
    const bodies = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].map(match => match[1]!)
    if (!bodies.length) return /<at:deleted-entry[\s>]/.test(xml) ? "deleted" : undefined
    if (bodies.length > 20) return undefined
    const entries = bodies.map(readEntry)
    return entries.every((entry): entry is YoutubeEntry => entry !== undefined) ? entries : undefined
}
// One entry, which needs its video ID, channel ID, title and published and updated times
function readEntry(body: string): YoutubeEntry | undefined {
    const videoId = element(body, "yt:videoId"), youtubeChannelId = element(body, "yt:channelId"), title = element(body, "title")?.trim()
    const publishedAt = time(element(body, "published")), updatedAt = time(element(body, "updated"))
    if (!videoId || !videoPattern.test(videoId) || !youtubeChannelId || !youtubeChannelPattern.test(youtubeChannelId) || !title || title.length > 1000
        || publishedAt === undefined || updatedAt === undefined) return undefined
    const channelTitle = authorName(body)
    return { videoId, youtubeChannelId, title, ...(channelTitle ? { channelTitle } : {}), publishedAt, updatedAt }
}
const authorName = (xml: string) => {
    const author = /<author>([\s\S]*?)<\/author>/.exec(xml), name = author ? element(author[1]!, "name")?.trim() : undefined
    return name ? name.slice(0, 256) : undefined
}

/** A channel's public feed of recent uploads. NeonFlux reads it once when a channel is added and never takes alerts from it */
export const youtubeFeedUrl = (youtubeChannelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`
export const YOUTUBE_FEED_TIMEOUT_MS = 5000
export type YoutubeFeed = { title?: string, newest?: { videoId: string, title: string, publishedAt: number } }
/**
 * The channel's name and newest upload from the start of its public feed, which may be cut off, so the feed's end is not needed. The
 * name comes from the feed's author, or its first entry's. An entry of another channel or an unreadable one names no upload
 */
export function parseYoutubeFeed(xml: string, youtubeChannelId: string): YoutubeFeed | undefined {
    if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<feed[\s>]/.test(xml)) return undefined
    const start = xml.search(/<entry[\s>]/), body = start < 0 ? undefined : /^<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/.exec(xml.slice(start))?.[1]
    const entry = body === undefined ? undefined : readEntry(body), newest = entry?.youtubeChannelId === youtubeChannelId ? entry : undefined
    const title = authorName(start < 0 ? xml : xml.slice(0, start)) ?? newest?.channelTitle
    return { ...(title ? { title } : {}), ...(newest ? { newest: { videoId: newest.videoId, title: newest.title, publishedAt: newest.publishedAt } } : {}) }
}

const clip = (text: string, maximum: number) => text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text
/**
 * An alert: A trimmed embed whose title links to the video's watch page, with YouTube's thumbnail and YouTube named as the source.
 * Mentions in titles are broken up, and the bot sends none. A test built from a video says it is a test above the embed. Without a video, as
 * in a test when no upload is known, it links the channel. In a forum the title also names the post, within Fluxer's 100 characters
 */
export function renderYoutubeAlert(youtubeChannelId: string, video: { videoId: string, title: string } | undefined, channelTitle: string | undefined, test = false): { content: PublishingContent, forumPostName: string } {
    const title = neutralMentions(video?.title ?? "Test alert from NeonFlux")
    const content = publishingContent({ content: test && video ? "Test alert from NeonFlux" : "", embed: { title: clip(title, 256), url: video ? youtubeWatchUrl(video.videoId) : youtubeChannelUrl(youtubeChannelId), color: YOUTUBE_RED,
        ...(channelTitle ? { author: { name: clip(neutralMentions(channelTitle), 256), url: youtubeChannelUrl(youtubeChannelId) } } : {}),
        ...(video ? { image: { url: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` } } : {}), footer: { text: "YouTube" } } }, true)
    return { content, forumPostName: clip(title, 100) }
}
