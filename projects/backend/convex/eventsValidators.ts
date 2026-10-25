import { v } from "convex/values"
import { EventsAllocation, EventsChoice, EventsDeliveryState, EventsLifecycle } from "@neonflux/contracts/events"
import { publishingContent } from "./publishingValidators.ts"
import { civilRecurrence } from "./schedulesValidators.ts"

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
    recurrence: civilRecurrence,
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
/** Members whose dates changed and who are still to be told: The changed dates, and where the claimed pages stopped */
export const eventsNotice = v.object({
    revision: v.number(),
    moves: v.array(
        v.object({ occurrenceNo: v.number(), fromStartsAt: v.number(), cancelled: v.optional(v.boolean()) }),
    ),
    cursor: v.optional(v.object({ afterUserId: v.string() })),
    sent: v.number(),
    failed: v.number(),
    // Changes made after this notice began going out. They become the next notice once this one is done
    next: v.optional(
        v.object({
            revision: v.number(),
            moves: v.array(
                v.object({ occurrenceNo: v.number(), fromStartsAt: v.number(), cancelled: v.optional(v.boolean()) }),
            ),
        }),
    ),
})
