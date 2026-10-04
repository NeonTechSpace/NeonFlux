import type * as C from "@neonflux/backend/contracts"
import { expandCivilCalendar, CivilCalendarError, type CivilRepeat } from "./civil-calendar.ts"

export type EventFoldPolicy = C.EventsFoldPolicy
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

export function eventDateText(value: { local: string, zone: string, offsetMinutes: number, startAt: number, endAt: number }) {
    const offset = value.offsetMinutes
    return `${value.local} ${value.zone}, UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}\nUTC ${new Date(value.startAt).toISOString()} through ${new Date(value.endAt).toISOString()}`
}

export function createEventCalendar(localMinute: string, zone: string, durationMinutes: number, fold: C.EventsFoldPolicy = "reject", recurrence: C.EventsRecurrence = { type: "none" }): C.EventsCalendar {
    const expanded = expandEventCalendar(localMinute, zone, durationMinutes, fold, recurrence.type === "none" ? undefined
        : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count })
    return { localMinute, zone, durationMinutes, fold, recurrence, dates: expanded.map(v => ({ localMinute: v.local, startsAt: v.startAt, endsAt: v.endAt, offsetMinutes: v.offsetMinutes })) }
}

export const resolvedEventDateText = (date: C.EventsResolvedDate, zone: string) => eventDateText({ local: date.localMinute, zone, offsetMinutes: date.offsetMinutes, startAt: date.startsAt, endAt: date.endsAt })
