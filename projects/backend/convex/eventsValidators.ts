import { v } from "convex/values"
import { EventsAllocation, EventsChoice, EventsDeliveryState, EventsLifecycle } from "@neonflux/contracts/events"
import { publishingContent } from "./publishingValidators.ts"

export const eventsState = v.union(...EventsLifecycle.literals.map((state) => v.literal(state)))
export const eventsChoice = v.union(...EventsChoice.literals.map((choice) => v.literal(choice)))
export const eventsAllocation = v.union(...EventsAllocation.literals.map((allocation) => v.literal(allocation)))
export const eventsDate = v.object({
    localMinute: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    offsetMinutes: v.number(),
})
export const eventsCalendar = v.object({
    localMinute: v.string(),
    zone: v.string(),
    fold: v.union(v.literal("reject"), v.literal("earlier"), v.literal("later")),
    durationMinutes: v.number(),
    recurrence: v.union(
        v.object({ type: v.literal("none") }),
        v.object({ type: v.union(v.literal("daily"), v.literal("weekly")), interval: v.number(), count: v.number() }),
    ),
    dates: v.array(eventsDate),
})
export const eventsTemplate = v.object({ name: v.string(), revision: v.number(), content: publishingContent })
export const eventsDeliveryState = v.union(...EventsDeliveryState.literals.map((state) => v.literal(state)))
export const publishingEventConsumer = v.object({
    type: v.literal("event"),
    eventNo: v.number(),
    revision: v.number(),
    purpose: v.union(v.literal("card"), v.literal("reminder")),
    occurrenceNo: v.optional(v.number()),
    offsetMinutes: v.optional(v.number()),
    deliveryId: v.optional(v.string()),
})
