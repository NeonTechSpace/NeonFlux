import type { SchedulesAutomationContext, SchedulesCalendar, SchedulesContentSource, SchedulesContext, SchedulesDeliveryBinding, SchedulesDeliveryCursor } from "../contracts.js"
import { validateCivilCalendar } from "./civilDomain.ts"

import { publishingKind, publishingName, shape } from "./publishingDomain.ts"
import { fail, requireId, integer, token } from "./validation.ts"
import { eventContext } from "./publishingContext.ts"

export const SCHEDULES_DAY = 86400000
export const SCHEDULES_BATCH = 20
export const advanceSchedule = (value: number) => integer(value + 1, 1, Number.MAX_SAFE_INTEGER)
export const scheduleContext = (value: unknown): SchedulesContext => eventContext(value)
export function automationContext(value: unknown, now = Date.now()): SchedulesAutomationContext {
    const r = shape(value, ["observedAt", "channelId", "botId", "botAuthorized"], ["observedAt", "channelId", "botId", "botAuthorized"])
    const observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    if (r.botAuthorized !== true) fail(403, "Automation destination unavailable")
    return { observedAt, channelId: requireId(r.channelId), botId: requireId(r.botId), botAuthorized: true }
}
export function scheduleContentSource(value: unknown): SchedulesContentSource {
    const r = shape(value, ["kind", "name", "revision"], ["kind", "name", "revision"])
    return { kind: publishingKind(r.kind), name: publishingName(r.name), revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER) }
}
export function validateScheduleCalendar(value: unknown, now = Date.now()): SchedulesCalendar {
    const r = shape(value, ["localMinute", "zone", "fold", "recurrence", "dates"], ["localMinute", "zone", "fold", "recurrence", "dates"])
    if (!Array.isArray(r.dates)) fail(400, "Complete recurrence required")
    const dates = r.dates.map(value => {
        const d = shape(value, ["localMinute", "dueAt", "offsetMinutes"], ["localMinute", "dueAt", "offsetMinutes"])
        return { localMinute: d.localMinute, instantAt: d.dueAt, offsetMinutes: d.offsetMinutes }
    })
    const calendar = validateCivilCalendar({ localMinute: r.localMinute, zone: r.zone, fold: r.fold, recurrence: r.recurrence, dates }, now)
    return { localMinute: calendar.localMinute, zone: calendar.zone, fold: calendar.fold, recurrence: calendar.recurrence, dates: calendar.dates.map(d => ({ localMinute: d.localMinute, dueAt: d.instantAt, offsetMinutes: d.offsetMinutes })) }
}
export function scheduleBinding(value: unknown): SchedulesDeliveryBinding {
    const r = shape(value, ["deliveryId", "scheduleNo", "planRevision", "occurrenceNo"], ["deliveryId", "scheduleNo", "planRevision", "occurrenceNo"])
    return { deliveryId: token(r.deliveryId), scheduleNo: integer(r.scheduleNo, 1, Number.MAX_SAFE_INTEGER), planRevision: integer(r.planRevision, 1, Number.MAX_SAFE_INTEGER), occurrenceNo: integer(r.occurrenceNo, 1, Number.MAX_SAFE_INTEGER) }
}
export function scheduleCursor(value: unknown, now: number): SchedulesDeliveryCursor {
    const r = shape(value, ["cursor", "throughAt"], ["cursor", "throughAt"])
    if (typeof r.cursor !== "string" || !r.cursor.length || r.cursor.length > 4096) fail(400, "Invalid schedule delivery cursor")
    return { cursor: r.cursor, throughAt: integer(r.throughAt, 0, now) }
}
