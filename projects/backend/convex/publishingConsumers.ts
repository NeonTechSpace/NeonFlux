import { v } from "convex/values"
import { publishingEventConsumer } from "./eventsValidators.ts"
import { publishingScheduleConsumer, scheduleSource } from "./schedulesValidators.ts"
import { milestoneKind, milestoneTemplate, publishingMilestoneConsumer } from "./milestonesValidators.ts"
import { publishingSuggestionConsumer } from "./suggestionsValidators.ts"

// Every feature that sends through the publisher records its source, consumer binding and provenance here
export const publishingSource = v.union(v.object({ type: v.literal("human"), messageId: v.string(), createdAt: v.number() }), v.object({ type: v.literal("event-timer"), deliveryId: v.string(), dueAt: v.number() }), v.object({ type: v.literal("schedule-timer"), deliveryId: v.string(), dueAt: v.number() }), v.object({ type: v.literal("milestone-timer"), deliveryId: v.string(), dueAt: v.number() }), publishingSuggestionConsumer)
export const publishingConsumer = v.union(publishingEventConsumer, publishingScheduleConsumer, publishingMilestoneConsumer, publishingSuggestionConsumer)
export const publishingProvenance = v.union(v.object({ type: v.literal("draft"), kind: v.union(v.literal("draft"), v.literal("template")), name: v.string(), revision: v.number() }), v.object({ type: v.literal("event"), eventNo: v.number(), revision: v.number(), template: v.optional(v.object({ name: v.string(), revision: v.number() })) }), v.object({ type: v.literal("schedule"), scheduleNo: v.number(), planRevision: v.number(), source: scheduleSource }), v.object({ type: v.literal("milestone"), kind: milestoneKind, intentRevision: v.number(), template: milestoneTemplate }), publishingSuggestionConsumer)
