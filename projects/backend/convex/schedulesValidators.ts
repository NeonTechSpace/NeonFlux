import { v } from "convex/values"
import { publishingKind } from "./publishingValidators.ts"

export const scheduleSource = v.object({ kind: publishingKind, name: v.string(), revision: v.number() })
export const scheduleDate = v.object({ localMinute: v.string(), dueAt: v.number(), offsetMinutes: v.number() })
export const scheduleCalendar = v.object({ localMinute: v.string(), zone: v.string(), fold: v.union(v.literal("reject"), v.literal("earlier"), v.literal("later")), recurrence: v.union(v.object({ type: v.literal("none") }), v.object({ type: v.union(v.literal("daily"), v.literal("weekly")), interval: v.number(), count: v.number() })), dates: v.array(scheduleDate) })
export const scheduleDeliveryState = v.union(v.literal("queued"), v.literal("blocked"), v.literal("reserved"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"), v.literal("skipped"), v.literal("cancelled"), v.literal("superseded"))
export const scheduleDeliveryReason = v.union(v.literal("activation-cutoff"), v.literal("late-window"), v.literal("superseded"), v.literal("cancelled"), v.literal("permission"), v.literal("capacity"), v.literal("dispatch-expired"))
export const publishingScheduleConsumer = v.object({ type: v.literal("schedule"), scheduleNo: v.number(), planRevision: v.number(), occurrenceNo: v.number(), deliveryId: v.string() })
