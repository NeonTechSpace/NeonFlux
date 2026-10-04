import { v } from "convex/values"
import { publishingScheduleConsumer, scheduleSource } from "./schedulesValidators.ts"

// Every feature that sends through the publisher records its source, consumer binding and provenance here
export const publishingSource = v.union(v.object({ type: v.literal("human"), messageId: v.string(), createdAt: v.number() }), v.object({ type: v.literal("schedule-timer"), deliveryId: v.string(), dueAt: v.number() }))
export const publishingConsumer = v.union(publishingScheduleConsumer)
export const publishingProvenance = v.union(v.object({ type: v.literal("draft"), kind: v.union(v.literal("draft"), v.literal("template")), name: v.string(), revision: v.number() }), v.object({ type: v.literal("schedule"), scheduleNo: v.number(), planRevision: v.number(), source: scheduleSource }))
