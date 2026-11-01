import { v } from "convex/values"

export const giveawayState = v.union(v.literal("running"), v.literal("ended"), v.literal("cancelled"))
// See GiveawayPhase in the contracts for what each one waits for
export const giveawayPhase = v.union(
    v.literal("post"),
    v.literal("sending"),
    v.literal("blocked"),
    v.literal("wait"),
    v.literal("draw"),
    v.literal("announce"),
    v.literal("announcing"),
    v.literal("cancel"),
    v.literal("cancelling"),
    v.literal("done"),
)
export const giveawayProblem = v.union(
    v.literal("channel"),
    v.literal("card"),
    v.literal("permission"),
    v.literal("post-failed"),
    v.literal("post-late"),
    v.literal("post-uncertain"),
    v.literal("result-failed"),
    v.literal("result-uncertain"),
    v.literal("reaction"),
)
export const giveawayDm = v.union(
    v.literal("pending"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("uncertain"),
)
/** A card is its own source, provenance and consumer in the publisher */
export const publishingGiveawayConsumer = v.object({ type: v.literal("giveaway"), giveawayNo: v.number() })
