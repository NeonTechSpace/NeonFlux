import { DateTime, Effect } from "effect"
import {
    CIVIL_HORIZON_DAYS,
    CIVIL_RANGE_REASON,
    CIVIL_WINDOW,
    CivilLocalDate,
    civilPastRange,
    type CivilFoldPolicy,
    type CivilResolvedDate,
    type CivilSkipped,
} from "@neonflux/contracts/civil"
import { Schema } from "effect"

export type { CivilFoldPolicy }
/** A repeat ends after count dates, after the local day until, or never */
export type CivilRepeat = { frequency: "daily" | "weekly"; interval: number; count?: number; until?: string }
export class CivilCalendarError extends Error {}

/** A later repeat date that was left out because its local time does not exist or repeats in the zone */
export const skippedDate = (skipped: CivilSkipped, zone: string) =>
    `${skipped.localMinute.replace("T", " ")}: that time ${skipped.reason === "nonexistent" ? "does not exist" : "repeats"} in ${zone}`
// The calendar constructors throw on input a member can mistype. Commands build them as a typed failure their handler
// replies to, while any other throw stays a defect
export const calendarFailure = <A>(create: () => A) =>
    Effect.try(create).pipe(
        Effect.catch((error) =>
            error.cause instanceof CivilCalendarError ? Effect.fail(error.cause) : Effect.die(error),
        ),
    )

function civil(local: string): DateTime.DateTime.Parts {
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(local)
    if (!match) throw new CivilCalendarError("Use an exact local minute: YYYY-MM-DDTHH:mm")
    const [year, month, day, hour, minute] = match.slice(1).map(Number)
    const parts = { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: 0, millisecond: 0 }
    if (
        parts.year < 100 ||
        parts.month < 1 ||
        parts.month > 12 ||
        parts.day < 1 ||
        parts.day > 31 ||
        parts.hour > 23 ||
        parts.minute > 59 ||
        !same(parts, DateTime.toPartsUtc(DateTime.makeUnsafe(parts)))
    )
        throw new CivilCalendarError("That date or time does not exist on the calendar")
    return parts
}
function same(a: DateTime.DateTime.Parts, b: DateTime.DateTime.Parts) {
    return (Object.keys(a) as (keyof DateTime.DateTime.Parts)[]).every((key) => a[key] === b[key])
}
function minute(parts: DateTime.DateTime.Parts) {
    const pad = (n: number, width = 2) => String(n).padStart(width, "0")
    return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * The first dates of a calendar, resolved in its zone: up to 26 dates within 180 days of the first, and within the repeat's end.
 * The backend adds later dates as these pass. Civil arithmetic happens on an unzoned calendar. Never validate an already
 * normalized zoned date
 */
export function expandCivilCalendar(
    local: string,
    zone: string,
    foldPolicy: CivilFoldPolicy = "reject",
    repeat?: CivilRepeat,
): CivilResolvedDate[] {
    if (!["reject", "earlier", "later"].includes(foldPolicy))
        throw new CivilCalendarError("Choose reject, earlier or later for repeated local minutes")
    if (
        repeat &&
        (!["daily", "weekly"].includes(repeat.frequency) ||
            !Number.isSafeInteger(repeat.interval) ||
            repeat.interval < 1 ||
            (repeat.count !== undefined && (!Number.isSafeInteger(repeat.count) || repeat.count < 1)) ||
            (repeat.until !== undefined && !Schema.is(CivilLocalDate)(repeat.until)) ||
            (repeat.count !== undefined && repeat.until !== undefined))
    )
        throw new CivilCalendarError(
            "Repeat daily or weekly, every 1 or more days or weeks, ending after a number of dates or on a date",
        )
    const original = DateTime.makeUnsafe(civil(local))
    if (
        repeat &&
        civilPastRange({
            localMinute: local,
            recurrence: {
                type: repeat.frequency,
                interval: repeat.interval,
                ...(repeat.count !== undefined ? { count: repeat.count } : {}),
                ...(repeat.until !== undefined ? { until: repeat.until } : {}),
            },
        })
    )
        throw new CivilCalendarError(CIVIL_RANGE_REASON)
    let timeZone: DateTime.TimeZone.Named
    try {
        timeZone = DateTime.zoneMakeNamedUnsafe(zone)
    } catch {
        throw new CivilCalendarError("Use a valid IANA timezone")
    }
    if (repeat?.until !== undefined && local.slice(0, 10) > repeat.until)
        throw new CivilCalendarError("The end date must not be before the first date")
    const values: CivilResolvedDate[] = []
    for (let index = 0; index < Math.min(repeat ? (repeat.count ?? CIVIL_WINDOW) : 1, CIVIL_WINDOW); index++) {
        const days = index * (repeat?.interval ?? 1) * (repeat?.frequency === "weekly" ? 7 : 1)
        // A date more than 180 days after the first, or past the end, is added by the backend later
        if (days > CIVIL_HORIZON_DAYS) break
        const parts = DateTime.toPartsUtc(DateTime.add(original, { days }))
        if (repeat?.until !== undefined && minute(parts).slice(0, 10) > repeat.until) break
        const earlier = DateTime.makeZonedUnsafe(parts, {
            timeZone,
            adjustForTimeZone: true,
            disambiguation: "earlier",
        })
        const later = DateTime.makeZonedUnsafe(parts, { timeZone, adjustForTimeZone: true, disambiguation: "later" })
        const missing = !same(parts, DateTime.toParts(earlier)) || !same(parts, DateTime.toParts(later)),
            repeated = DateTime.toEpochMillis(earlier) !== DateTime.toEpochMillis(later) && foldPolicy === "reject"
        // Only the first date must name one instant. The window ends before a later date that does not, and the backend skips
        // and shows that date when it adds the next ones
        if (index > 0 && (missing || repeated)) break
        if (missing) throw new CivilCalendarError(`${minute(parts)} does not exist in ${zone}. Choose another minute`)
        if (repeated)
            throw new CivilCalendarError(`${minute(parts)} repeats in ${zone}. Choose earlier or later explicitly`)
        const resolved = foldPolicy === "later" ? later : earlier
        const startAt = DateTime.toEpochMillis(resolved)
        const civilAt = DateTime.toEpochMillis(DateTime.makeUnsafe(parts))
        if (values.length && startAt - values[0]!.instantAt > CIVIL_HORIZON_DAYS * 86400000) break
        values.push({ localMinute: minute(parts), offsetMinutes: (civilAt - startAt) / 60000, instantAt: startAt })
    }
    return values
}
