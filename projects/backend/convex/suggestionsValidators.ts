import { v } from "convex/values"

export const suggestionState = v.union(v.literal("under-review"), v.literal("planned"), v.literal("completed"), v.literal("declined"), v.literal("withdrawn"))
export const suggestionChoice = v.union(v.literal("up"), v.literal("down"), v.literal("clear"))
export const suggestionCardState = v.union(v.literal("queued"), v.literal("reserved"), v.literal("current"), v.literal("blocked"))
export const suggestionBindingFields = { suggestionNo: v.number(), cardGeneration: v.number(), desiredRevision: v.number() }
export const publishingSuggestionConsumer = v.object({ type: v.literal("suggestion-card"), ...suggestionBindingFields })
