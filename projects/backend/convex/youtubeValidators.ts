import { v } from "convex/values"

export const youtubeMode = v.union(v.literal("subscribe"), v.literal("unsubscribe"))
/** The newest upload a channel's public feed named when it was added. Test alerts show it, and alerts never come from it */
export const youtubePreview = v.object({ videoId: v.string(), title: v.string(), publishedAt: v.number() })
export const youtubeProblem = v.union(v.literal("channel"), v.literal("permission"))
// queued waits for the bot, reserved holds a publishing attempt, and sent, failed and uncertain follow its outcome. skipped will not be posted
export const youtubeDeliveryState = v.union(v.literal("queued"), v.literal("reserved"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"), v.literal("skipped"))
/** An alert is its own source, provenance and consumer in the publisher */
export const publishingYoutubeConsumer = v.object({ type: v.literal("youtube"), youtubeChannelId: v.string(), videoId: v.string() })
