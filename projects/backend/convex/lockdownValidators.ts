import { v } from "convex/values"
import { permissionOverwrite } from "./moderationValidators.ts"

export const lockdownState = v.union(
    v.literal("locking"),
    v.literal("active"),
    v.literal("restoring"),
    v.literal("ended"),
)
export const lockdownOrigin = v.union(v.literal("command"), v.literal("dashboard"), v.literal("antinuke"))
export const lockdownChannelState = v.union(
    v.literal("queued"),
    v.literal("writing"),
    v.literal("locked"),
    v.literal("uncertain"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("restored"),
)
export const lockdownCounts = v.object({
    queued: v.number(),
    writing: v.number(),
    locked: v.number(),
    uncertain: v.number(),
    failed: v.number(),
    skipped: v.number(),
    restored: v.number(),
})
export const lockdownChannelFields = {
    serverId: v.string(),
    channelId: v.string(),
    phase: v.union(v.literal("lock"), v.literal("restore")),
    state: lockdownChannelState,
    skip: v.optional(v.union(v.literal("exempt"), v.literal("private"), v.literal("held"), v.literal("gone"))),
    everyone: permissionOverwrite,
    bits: v.string(),
    botBefore: permissionOverwrite,
    botSet: v.optional(v.object({ allow: v.string(), deny: v.string() })),
    // Set only while the worker owes this channel a write, so the dispatcher's index holds nothing else
    active: v.optional(v.literal(true)),
    nextCheckAt: v.number(),
    // Writes known unsent so far, which a restart keeps counting
    tries: v.optional(v.number()),
    // Whether a write was ever claimed, so a lift knows the channel may hold NeonFlux's own allow
    attempted: v.optional(v.literal(true)),
}
