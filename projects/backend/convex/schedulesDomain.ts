import { SchedulesAutomationContext, SchedulesCalendar, SchedulesSourceInput, type SchedulesContext } from "@neonflux/contracts/schedules"
import type { SchedulesContentSource } from "@neonflux/contracts/publishing-base"
import { validateCivilCalendar } from "./civilDomain.ts"

import { publishingName } from "./publishingDomain.ts"
import { decode, integer } from "./validation.ts"
import { eventContext } from "./publishingContext.ts"

export { SCHEDULES_BATCH } from "@neonflux/contracts/schedules"
export const SCHEDULES_DAY = 86400000
/** Schedules or posts per page of a chat list */
export const SCHEDULES_PAGE = 10
export const advanceSchedule = (value: number) => integer(value + 1, 1, Number.MAX_SAFE_INTEGER)
/** Native reads are fresh for a minute */
export const recentObservation = (observedAt: number, now = Date.now()) => integer(observedAt, Math.max(0, now - 60000), now + 1000)
export const scheduleContext = (value: unknown): SchedulesContext => eventContext(value)
export function automationContext(value: unknown, now = Date.now()): SchedulesAutomationContext {
    const context = decode(SchedulesAutomationContext, value)
    recentObservation(context.observedAt, now)
    return context
}
export function scheduleContentSource(value: unknown): SchedulesContentSource {
    const source = decode(SchedulesSourceInput, value)
    return { ...source, name: publishingName(source.name) }
}
export function validateScheduleCalendar(value: unknown, now = Date.now()): SchedulesCalendar {
    const calendar = decode(SchedulesCalendar, value)
    validateCivilCalendar({ ...calendar, dates: calendar.dates.map(date => ({ localMinute: date.localMinute, instantAt: date.dueAt, offsetMinutes: date.offsetMinutes })) }, now)
    return calendar
}
