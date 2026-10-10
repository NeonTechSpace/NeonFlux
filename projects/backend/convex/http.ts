import { httpRouter } from "convex/server"
import { isYoutubeChannelId } from "@neonflux/contracts/youtube"
import { httpAction } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { readBody, YOUTUBE_CALLBACK_PATH, YOUTUBE_NOTIFICATION_BYTES } from "./youtubeDomain.ts"

// The deployment's only HTTP route. YouTube's WebSub hub confirms subscription requests with GET and delivers notifications with POST,
// see youtubeHub.ts. Each callback names its channel, so the per-channel secret is known before the body is read, and carries the source's token
const http = httpRouter()
const channelOf = (request: Request) => {
    const value = new URL(request.url).searchParams.get("channel")
    return value && isYoutubeChannelId(value) ? value : null
}
const status = (code: number) => new Response(null, { status: code })

http.route({ path: YOUTUBE_CALLBACK_PATH, method: "GET", handler: httpAction(async (ctx, request) => {
    const youtubeChannelId = channelOf(request), params = new URL(request.url).searchParams
    const token = params.get("token"), mode = params.get("hub.mode"), topic = params.get("hub.topic"), challenge = params.get("hub.challenge"), leaseSeconds = params.get("hub.lease_seconds"), reason = params.get("hub.reason")
    if (!youtubeChannelId || !token || !mode || !topic || mode !== "denied" && !challenge) return status(404)
    const accepted = await ctx.runMutation(internal.youtubeHub.verify, { youtubeChannelId, token, mode, topic, ...(leaseSeconds !== null ? { leaseSeconds } : {}), ...(reason !== null ? { reason } : {}) })
    if (!accepted) return status(404)
    return new Response(mode === "denied" ? "" : challenge, { status: 200, headers: { "Content-Type": "text/plain" } })
}) })

// Notifications are checked by their signature, so they need no token
http.route({ path: YOUTUBE_CALLBACK_PATH, method: "POST", handler: httpAction(async (ctx, request) => {
    const youtubeChannelId = channelOf(request)
    if (!youtubeChannelId) return status(404)
    if (Number(request.headers.get("content-length") ?? 0) > YOUTUBE_NOTIFICATION_BYTES) return status(413)
    // A body without a length is read only up to the limit
    const body = await readBody(request.body, YOUTUBE_NOTIFICATION_BYTES)
    if (!body) return status(413)
    const result = await ctx.runMutation(internal.youtubeHub.notify, { youtubeChannelId, signature: request.headers.get("x-hub-signature"), body })
    return status({ accepted: 204, unknown: 404, rejected: 403, unreadable: 400 }[result])
}) })

export default http
