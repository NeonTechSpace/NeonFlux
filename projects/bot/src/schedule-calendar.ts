import type { CivilFoldPolicy, CivilRecurrence } from "@neonflux/contracts/civil"
import type { SchedulesCalendar } from "@neonflux/contracts/schedules"
import { expandCivilCalendar } from "./civil-calendar.ts"

export function createScheduleCalendar(localMinute: string, zone: string, fold: CivilFoldPolicy, recurrence: CivilRecurrence = { type: "none" }): SchedulesCalendar {
    const dates = expandCivilCalendar(localMinute, zone, fold, recurrence.type === "none" ? undefined : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count })
    return { localMinute, zone, fold, recurrence, dates: dates.map(date => ({ localMinute: date.localMinute, dueAt: date.instantAt, offsetMinutes: date.offsetMinutes })) }
}
