import { v } from "convex/values"
import { publishingContent } from "./publishingValidators.ts"

export const eventsState = v.union(v.literal("draft"), v.literal("open"), v.literal("started"), v.literal("completed"), v.literal("cancelled"))
export const eventsChoice = v.union(v.literal("going"), v.literal("maybe"), v.literal("not-going"), v.literal("none"))
export const eventsAllocation = v.union(v.literal("seat"), v.literal("waitlist"), v.literal("none"))
export const eventsDate = v.object({ localMinute: v.string(), startsAt: v.number(), endsAt: v.number(), offsetMinutes: v.number() })
export const eventsCalendar = v.object({ localMinute: v.string(), zone: v.string(), fold: v.union(v.literal("reject"), v.literal("earlier"), v.literal("later")), durationMinutes: v.number(), recurrence: v.union(v.object({ type: v.literal("none") }), v.object({ type: v.union(v.literal("daily"), v.literal("weekly")), interval: v.number(), count: v.number() })), dates: v.array(eventsDate) })
export const eventsTemplate = v.object({ name: v.string(), revision: v.number(), content: publishingContent })
export const eventsDeliveryState = v.union(v.literal("queued"), v.literal("blocked"), v.literal("reserved"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"), v.literal("skipped"), v.literal("cancelled"))
export const publishingEventConsumer = v.object({ type: v.literal("event"), eventNo: v.number(), revision: v.number(), purpose: v.union(v.literal("card"), v.literal("reminder")), occurrenceNo: v.optional(v.number()), offsetMinutes: v.optional(v.number()), deliveryId: v.optional(v.string()) })
