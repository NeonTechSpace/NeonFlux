import { v } from "convex/values"

export const feedProvider = v.union(v.literal("bluesky"), v.literal("x"))
export const feedProblem = v.union(v.literal("channel"), v.literal("permission"))
// queued waits for the bot, reserved holds a publishing attempt, and sent, failed and uncertain follow its outcome. skipped will not be posted
export const feedDeliveryState = v.union(
    v.literal("queued"),
    v.literal("reserved"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("uncertain"),
    v.literal("skipped"),
)
/** A post is its own source, provenance and consumer in the publisher */
export const publishingFeedConsumer = v.object({
    type: v.literal("feed"),
    provider: feedProvider,
    accountId: v.string(),
    itemId: v.string(),
})
