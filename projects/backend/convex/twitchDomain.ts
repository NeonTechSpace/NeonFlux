import { cutText } from "@neonflux/contracts/common"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { TwitchDeliveryContext, TwitchOperation } from "@neonflux/contracts/twitch"
import { neutralMentions } from "./memberContent.ts"
import { publishingContent } from "./publishingDomain.ts"
import { decode, fail } from "./validation.ts"
export { TWITCH_LIMIT } from "@neonflux/contracts/twitch"
export { hubBackoff, readBody } from "./youtubeDomain.ts"
// A live alert is stale long before a video is, so one the bot could not post within two hours is dropped
export const TWITCH_ALERT_WINDOW_MS = 7200000,
    TWITCH_RETENTION_MS = 30 * 86400000,
    TWITCH_RETRY_MS = 60000
// 64 KiB leaves ample room for a single stream.online event and bounds unauthenticated reads
export const TWITCH_NOTIFICATION_BYTES = 65536,
    TWITCH_CALLBACK_PATH = "/eventsub/twitch"
export const twitchOperation = (value: unknown): TwitchOperation => decode(TwitchOperation, value)
export function twitchDeliveryContext(value: unknown, now = Date.now()): TwitchDeliveryContext {
    const context = decode(TwitchDeliveryContext, value)
    if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
    return context
}
/** The callback uses the same origin override as YouTube, independently of its hub */
export function twitchConfig() {
    const clientId = process.env.NEONFLUX_TWITCH_CLIENT_ID,
        clientSecret = process.env.NEONFLUX_TWITCH_CLIENT_SECRET
    try {
        const url = new URL(process.env.NEONFLUX_WEBSUB_CALLBACK_BASE ?? process.env.CONVEX_SITE_URL ?? "")
        return clientId &&
            clientSecret &&
            url.protocol === "https:" &&
            !url.port &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === "/"
            ? { clientId, clientSecret, callbackOrigin: url.origin }
            : null
    } catch {
        return null
    }
}
/** EventSub signs message ID, timestamp and exact raw bytes, before JSON is read */
export async function twitchSignatureMatches(
    secret: string,
    signature: string | null,
    id: string,
    timestamp: string,
    body: ArrayBuffer,
    now = Date.now(),
) {
    const at = Date.parse(timestamp)
    if (
        !id ||
        id.length > 256 ||
        !Number.isFinite(at) ||
        at < now - 600000 ||
        at > now + 60000 ||
        !/^sha256=[0-9a-f]{64}$/.test(signature ?? "")
    )
        return false
    const prefix = new TextEncoder().encode(id + timestamp),
        bytes = new Uint8Array(prefix.length + body.byteLength)
    bytes.set(prefix)
    bytes.set(new Uint8Array(body), prefix.length)
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
    )
    const digest = Uint8Array.from(signature!.slice(7).match(/../g)!, (byte) => parseInt(byte, 16))
    return crypto.subtle.verify("HMAC", key, digest, bytes)
}
const clip = (text: string, max: number) => (text.length > max ? `${cutText(text, max - 1)}…` : text)
/** One embed, with mentions broken up and a placeholder when no stream is known */
export function renderTwitchAlert(
    login: string,
    stream: { title: string; game?: string; thumbnail?: string } | undefined,
    displayName: string | undefined,
    test = false,
): { content: PublishingContent; forumPostName: string } {
    const title = neutralMentions(
            stream?.title || (test ? "Test alert from NeonFlux" : `${displayName ?? login} is live`),
        ),
        url = `https://www.twitch.tv/${login}`
    return {
        forumPostName: clip(title, 100),
        content: publishingContent(
            {
                content: test && stream ? "Test alert from NeonFlux" : "",
                embed: {
                    title: clip(title, 256),
                    url,
                    color: 0x9146ff,
                    author: { name: clip(neutralMentions(displayName ?? login), 256), url },
                    ...(stream?.game ? { description: clip(neutralMentions(stream.game), 256) } : {}),
                    ...(stream?.thumbnail ? { image: { url: stream.thumbnail } } : {}),
                    footer: { text: "Twitch" },
                },
            },
            true,
        ),
    }
}
