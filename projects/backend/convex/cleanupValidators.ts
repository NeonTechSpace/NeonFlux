import { v } from "convex/values"

const nullableId = v.union(v.string(), v.null()), nullableBool = v.union(v.boolean(), v.null())
export const cleanupMessage = v.object({ messageId: v.string(), channelId: v.string(), serverId: nullableId, observedAt: v.number(), createdAt: nullableId, authorId: nullableId, authorBot: nullableBool, authorSystem: nullableBool, type: v.union(v.number(), v.null()), pinned: nullableBool, webhookId: nullableId })
export const cleanupSkipReason = v.union(v.literal("pinned"), v.literal("pin-unknown"), v.literal("bot"), v.literal("webhook"), v.literal("system"), v.literal("identity-unknown"), v.literal("timestamp-unknown"), v.literal("too-new"), v.literal("excluded-author"), v.literal("excluded-message"), v.literal("protected"), v.literal("retained-attempt"))
export const cleanupBindingFields = { channelId: v.string(), policyRevision: v.number(), moduleRevision: v.number(), sweepNo: v.number() }
export const cleanupTargetBindingFields = { ...cleanupBindingFields, pageNo: v.number(), targetNo: v.number(), messageId: v.string() }
export const cleanupCounts = v.object({ scanned: v.number(), skipped: v.number(), attempted: v.number(), submitted: v.number(), acknowledged: v.number(), observedAbsent: v.number(), unresolved: v.number(), failed: v.number(), cancelled: v.number() })
export const cleanupGrant = v.object({ ...cleanupTargetBindingFields, ownerId: v.string(), botId: v.string(), cutoffAt: v.number(), createdAt: v.string(), authorId: v.string(), dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000) })
export const cleanupObservation = v.object({ messageId: v.string(), channelId: v.string(), observedAt: v.number(), status: v.union(v.literal("present"), v.literal("absent"), v.literal("unknown")), channelVisible: v.boolean() })
export const cleanupTargetState = v.union(v.literal("queued"), v.literal("reserved"), v.literal("deleted"), v.literal("failed"), v.literal("uncertain"), v.literal("absent"), v.literal("skipped"), v.literal("cancelled"))
export const cleanupPageItem = v.object({ message: cleanupMessage, disposition: v.union(v.literal("eligible"), v.literal("skipped")), reason: v.optional(cleanupSkipReason), targetNo: v.optional(v.number()) })
