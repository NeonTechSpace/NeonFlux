import type { EventsFoldPolicy, EventsRecurrence, EventsCalendar } from "@neonflux/contracts/events"
import { expandCivilCalendar, CivilCalendarError, type CivilRepeat } from "./civil-calendar.ts"

export type EventFoldPolicy = EventsFoldPolicy
export type EventRepeat = CivilRepeat
export class EventCalendarError extends Error {}

export function expandEventCalendar(local: string, zone: string, durationMinutes: number, foldPolicy: EventFoldPolicy = "reject", repeat?: EventRepeat) {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) throw new EventCalendarError("Duration must be 1 through 10080 elapsed minutes")
    try {
        return expandCivilCalendar(local, zone, foldPolicy, repeat).map(date => ({ local: date.localMinute, zone, offsetMinutes: date.offsetMinutes, startAt: date.instantAt, endAt: date.instantAt + durationMinutes * 60000 }))
    } catch (error) {
        if (error instanceof CivilCalendarError) throw new EventCalendarError(error.message)
        throw error
    }
}

export function createEventCalendar(localMinute: string, zone: string, durationMinutes: number, fold: EventsFoldPolicy = "reject", recurrence: EventsRecurrence = { type: "none" }): EventsCalendar {
    const expanded = expandEventCalendar(localMinute, zone, durationMinutes, fold, recurrence.type === "none" ? undefined
        : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count })
    return { localMinute, zone, durationMinutes, fold, recurrence, dates: expanded.map(v => ({ localMinute: v.local, startsAt: v.startAt, endsAt: v.endAt, offsetMinutes: v.offsetMinutes })) }
}
