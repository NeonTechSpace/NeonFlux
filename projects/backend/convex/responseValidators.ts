import { v } from "convex/values"

export const responseKind = v.union(v.literal("custom"), v.literal("auto"))
export const responseTrigger = v.object({ mode: v.union(v.literal("exact"), v.literal("contains")), text: v.string() })
export const responseReply = v.union(
    v.object({ type: v.literal("text"), text: v.string() }),
    v.object({ type: v.literal("embed"), embed: v.object({ title: v.string(), description: v.string(), color: v.optional(v.number()) }) }),
)
