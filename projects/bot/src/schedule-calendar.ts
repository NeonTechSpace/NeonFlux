import type * as C from "@neonflux/backend/contracts"
import { expandCivilCalendar } from "./civil-calendar.ts"

export function createScheduleCalendar(localMinute: string, zone: string, fold: C.CivilFoldPolicy, recurrence: C.CivilRecurrence = { type: "none" }): C.SchedulesCalendar {
    const dates = expandCivilCalendar(localMinute, zone, fold, recurrence.type === "none" ? undefined : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count })
    return { localMinute, zone, fold, recurrence, dates: dates.map(date => ({ localMinute: date.localMinute, dueAt: date.instantAt, offsetMinutes: date.offsetMinutes })) }
}
