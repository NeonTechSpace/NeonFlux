import type { CivilFoldPolicy, CivilRecurrence } from "@neonflux/contracts/civil"
import { eventsDurationProblem, type EventsCalendar } from "@neonflux/contracts/events"
import { CivilCalendarError, expandCivilCalendar } from "./civil-calendar.ts"

export function createEventCalendar(
    localMinute: string,
    zone: string,
    durationMinutes: number,
    fold: CivilFoldPolicy = "reject",
    recurrence: CivilRecurrence = { type: "none" },
): EventsCalendar {
    // A repeat's dates last at most 180 days and a single date until the calendar's last day, also when a single date
    // becomes a repeat
    const problem = eventsDurationProblem({ localMinute, recurrence, durationMinutes })
    if (problem) throw new CivilCalendarError(problem)
    const dates = expandCivilCalendar(
        localMinute,
        zone,
        fold,
        recurrence.type === "none" ? undefined : { ...recurrence, frequency: recurrence.type },
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
