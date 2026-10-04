import type * as C from "@neonflux/backend/contracts"
import { expandCivilCalendar } from "./civil-calendar.ts"

export function createScheduleCalendar(localMinute: string, zone: string, fold: C.CivilFoldPolicy, recurrence: C.CivilRecurrence = { type: "none" }): C.SchedulesCalendar {
    const dates = expandCivilCalendar(localMinute, zone, fold, recurrence.type === "none" ? undefined : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count })
    return { localMinute, zone, fold, recurrence, dates: dates.map(date => ({ localMinute: date.localMinute, dueAt: date.instantAt, offsetMinutes: date.offsetMinutes })) }
}

export function scheduleDateText(date: C.SchedulesResolvedDate, zone: string) {
    const offset = date.offsetMinutes
    return `${date.localMinute} ${zone}, UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")} = ${new Date(date.dueAt).toISOString()}`
}
