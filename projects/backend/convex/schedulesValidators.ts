import { v } from "convex/values"
import { SchedulesDeliveryReason, SchedulesDeliveryState } from "@neonflux/contracts/schedules"
import { publishingKind } from "./publishingValidators.ts"

export const scheduleSource = v.object({ kind: publishingKind, name: v.string(), revision: v.number() })
export const scheduleDate = v.object({ localMinute: v.string(), dueAt: v.number(), offsetMinutes: v.number() })
/** A repeat ends after count dates, after the local day until, or never. Scheduled publishing and events share it */
export const civilRecurrence = v.union(
    v.object({ type: v.literal("none") }),
    v.object({
        type: v.union(v.literal("daily"), v.literal("weekly")),
        interval: v.number(),
        count: v.optional(v.number()),
        until: v.optional(v.string()),
    }),
)
/** A later date that was not added because its local time does not exist or repeats */
export const civilSkipped = v.object({
    localMinute: v.string(),
    reason: v.union(v.literal("nonexistent"), v.literal("ambiguous")),
})
export const scheduleCalendar = v.object({
    localMinute: v.string(),
    zone: v.string(),
    fold: v.union(v.literal("reject"), v.literal("earlier"), v.literal("later")),
    recurrence: civilRecurrence,
    dates: v.array(scheduleDate),
})
export const scheduleDeliveryState = v.union(...SchedulesDeliveryState.literals.map((state) => v.literal(state)))
export const scheduleDeliveryReason = v.union(...SchedulesDeliveryReason.literals.map((reason) => v.literal(reason)))
export const publishingScheduleConsumer = v.object({
    type: v.literal("schedule"),
    scheduleNo: v.number(),
    planRevision: v.number(),
    occurrenceNo: v.number(),
    deliveryId: v.string(),
})
