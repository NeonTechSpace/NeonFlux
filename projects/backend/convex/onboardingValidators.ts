import { v } from "convex/values"

export const onboardingStep = v.union(v.object({ type: v.literal("rules") }), v.object({ type: v.literal("panel"), name: v.string() }), v.object({ type: v.literal("menu"), name: v.string() }),
    v.object({ type: v.literal("link"), channelId: v.string(), text: v.string() }))
