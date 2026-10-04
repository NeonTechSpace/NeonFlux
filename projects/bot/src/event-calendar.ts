import type { CivilFoldPolicy, CivilRecurrence } from "@neonflux/contracts/civil"
import type { EventsCalendar } from "@neonflux/contracts/events"
import { CivilCalendarError, expandCivilCalendar } from "./civil-calendar.ts"

export function createEventCalendar(
    localMinute: string,
    zone: string,
    durationMinutes: number,
    fold: CivilFoldPolicy = "reject",
    recurrence: CivilRecurrence = { type: "none" },
): EventsCalendar {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080)
        throw new CivilCalendarError("Duration must be 1 through 10080 elapsed minutes")
    const dates = expandCivilCalendar(
        localMinute,
        zone,
        fold,
        recurrence.type === "none"
            ? undefined
            : { frequency: recurrence.type, interval: recurrence.interval, count: recurrence.count },
    )
    return {
        localMinute,
        zone,
        durationMinutes,
        fold,
        recurrence,
        dates: dates.map((date) => ({
            localMinute: date.localMinute,
            startsAt: date.instantAt,
            endsAt: date.instantAt + durationMinutes * 60000,
            offsetMinutes: date.offsetMinutes,
        })),
    }
}
