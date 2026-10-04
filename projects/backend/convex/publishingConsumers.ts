import { v } from "convex/values"
import { publishingScheduleConsumer, scheduleSource } from "./schedulesValidators.ts"
import { publishingKind } from "./publishingValidators.ts"

// Every feature that sends through the publisher records its source, consumer binding and provenance here
export const publishingSource = v.union(
    v.object({ type: v.literal("human"), messageId: v.string(), createdAt: v.number() }),
    v.object({ type: v.literal("schedule-timer"), deliveryId: v.string(), dueAt: v.number() }),
)
export const publishingConsumer = publishingScheduleConsumer
export const publishingProvenance = v.union(
    v.object({ type: v.literal("draft"), kind: publishingKind, name: v.string(), revision: v.number() }),
    v.object({ type: v.literal("schedule"), scheduleNo: v.number(), planRevision: v.number(), source: scheduleSource }),
)
