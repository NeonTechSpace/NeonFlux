import {
    CIVIL_HORIZON_DAYS,
    CIVIL_RANGE_REASON,
    CIVIL_WINDOW,
    CivilCalendar,
    civilLocalAt,
    civilPastRange,
    type CivilFoldPolicy,
    type CivilRecurrence,
    type CivilResume,
    type CivilSkipped,
} from "@neonflux/contracts/civil"
import { decode, fail } from "./validation.ts"

export const CIVIL_DAY = 86400000
function civil(value: unknown) {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
        fail(400, "Explicit local minute required")
    const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
    const ms = Date.UTC(year!, month! - 1, day!, hour!, minute!)
    if (new Date(ms).toISOString().slice(0, 16) !== value) fail(400, "Invalid civil date")
    return { text: value, ms }
}
function formatter(zone: unknown) {
    if (typeof zone !== "string" || zone.length > 128 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone))
        fail(400, "IANA timezone required")
    try {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: zone,
            calendar: "iso8601",
            numberingSystem: "latn",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        })
    } catch {
        fail(400, "Invalid IANA timezone")
    }
}
function localAt(format: Intl.DateTimeFormat, instant: number) {
    const fields = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]))
    return Date.UTC(
        Number(fields.year),
        Number(fields.month) - 1,
        Number(fields.day),
        Number(fields.hour),
        Number(fields.minute),
        Number(fields.second),
    )
}
/** The first instant at or after the local midnight that follows the due time */
export function civilDayEnd(dueAt: number, zone: string) {
    const format = formatter(zone),
        local = localAt(format, dueAt),
        midnight = (Math.floor(local / CIVIL_DAY) + 1) * CIVIL_DAY
    // Try the due time's offset, then the offset in force at that guess, and keep the earliest instant already at or past midnight
    const first = midnight - (local - dueAt),
        second = midnight - (localAt(format, first) - first)
    return [second, first].filter((instant) => localAt(format, instant) >= midnight).sort((a, b) => a - b)[0] ?? second
}
// A late timer still sends until the next local midnight in its zone, so the cutoff follows daylight-saving changes
export function civilDayEnded(dueAt: number, zone: string, now: number) {
    return now >= dueAt && now >= civilDayEnd(dueAt, zone)
}
/** The instant a local minute names in a zone, or why it names none: it does not exist, or it repeats while fold is reject */
export function resolveCivil(localMinute: string, zone: string, fold: CivilFoldPolicy) {
    const intended = civil(localMinute),
        format = formatter(zone),
        offsets = new Set<number>()
    for (let hours = -48; hours <= 48; hours += 3) {
        const instant = intended.ms + hours * 3600000
        offsets.add((localAt(format, instant) - instant) / 60000)
    }
    const candidates = [...offsets]
        .map((offset) => intended.ms - offset * 60000)
        .filter((instant) => localAt(format, instant) === intended.ms)
        .sort((a, b) => a - b)
    if (!candidates.length) return "nonexistent" as const
    if (candidates.length > 1 && fold === "reject") return "ambiguous" as const
    const instantAt = fold === "later" ? candidates.at(-1)! : candidates[0]!
    return { instantAt, offsetMinutes: (intended.ms - instantAt) / 60000 }
}
export function resolveCivilInstant(localMinute: string, zone: string, fold: CivilFoldPolicy) {
    const resolved = resolveCivil(localMinute, zone, fold)
    if (resolved === "nonexistent") fail(400, "Nonexistent local time")
    if (resolved === "ambiguous") fail(400, "Ambiguous local time requires earlier or later")
    return resolved
}
// The schema checks the recurrence, and its dates must stay within the calendar's range. Each local minute must also resolve in
// the zone to its supplied instant in the future
export function validateCivilCalendar(value: unknown, now = Date.now()): CivilCalendar {
    const calendar = decode(CivilCalendar, value)
    if (civilPastRange(calendar)) fail(400, CIVIL_RANGE_REASON)
    for (const date of calendar.dates) {
        const resolved = resolveCivilInstant(date.localMinute, calendar.zone, calendar.fold)
        if (date.instantAt !== resolved.instantAt || date.offsetMinutes !== resolved.offsetMinutes)
            fail(400, "Civil offset or UTC binding changed")
        if (resolved.instantAt <= now) fail(400, "Calendar dates must be in the future")
    }
    return calendar
}
/**
 * The next dates of a repeat to store, from the date at index from. Stored dates that have not started are at most 26, and a new
 * one is at most 180 days ahead of now unless none would be stored. A later local time that does not exist, or repeats while the
 * fold policy is reject, is skipped and named, never guessed. nextAt is when the horizon reaches the next date, and done says
 * the repeat has no dates left to add
 */
export function materializeCivil(
    calendar: { localMinute: string; zone: string; fold: CivilFoldPolicy; recurrence: CivilRecurrence },
    from: number,
    live: number,
    now: number,
) {
    const dates: { localMinute: string; instantAt: number; offsetMinutes: number }[] = []
    let index = from,
        skipped: CivilSkipped | undefined,
        nextAt: number | undefined
    while (live + dates.length < CIVIL_WINDOW) {
        const localMinute = civilLocalAt(calendar, index)
        if (localMinute === undefined) return { dates, next: index, skipped, done: true }
        const resolved = resolveCivil(localMinute, calendar.zone, calendar.fold)
        if (typeof resolved === "string") skipped = { localMinute, reason: resolved }
        else if (resolved.instantAt > now + CIVIL_HORIZON_DAYS * CIVIL_DAY && live + dates.length > 0) {
            nextAt = resolved.instantAt - CIVIL_HORIZON_DAYS * CIVIL_DAY
            break
        } else if (resolved.instantAt > now) dates.push({ localMinute, ...resolved })
        index++
    }
    return { dates, next: index, skipped, done: false, nextAt }
}
/**
 * Where a change to a repeat continues once its first date, at firstAt, has started: The first date of its plan after now and the
 * dates left from there under a count. A count whose dates have all started has 0 left, at the date its series would come to
 * next. Undefined before the first date, for a single date, after the end date and while the zone cannot be read
 */
export function civilResume(
    calendar: { localMinute: string; zone: string; fold: CivilFoldPolicy; recurrence: CivilRecurrence },
    firstAt: number,
    now: number,
): CivilResume | undefined {
    const r = calendar.recurrence
    if (r.type === "none" || firstAt > now) return undefined
    const step = r.interval * (r.type === "weekly" ? 7 : 1) * CIVIL_DAY
    try {
        // A clock change moves a date by hours, so the date one step before the estimate has started
        const { count, ...series } = r
        for (let index = Math.max(0, Math.floor((now - firstAt) / step) - 1); ; index++) {
            const localMinute = civilLocalAt({ ...calendar, recurrence: series }, index)
            if (localMinute === undefined) return undefined
            const resolved = resolveCivil(localMinute, calendar.zone, calendar.fold)
            if (typeof resolved !== "string" && resolved.instantAt > now)
                return { localMinute, ...(count !== undefined ? { count: Math.max(0, count - index) } : {}) }
        }
    } catch {
        // A zone this runtime cannot read gives no place to continue, and the answer goes out without it
        return undefined
    }
}
/**
 * A repeat whose first date, at firstAt, has started, begun again at its first date after now: The same series from there, a count
 * reduced to the dates left, and its first dates as a new calendar stores them. Undefined when no date is left
 */
export function civilRestart(
    calendar: { localMinute: string; zone: string; fold: CivilFoldPolicy; recurrence: CivilRecurrence },
    firstAt: number,
    now: number,
) {
    const resume = civilResume(calendar, firstAt, now)
    if (!resume || resume.count === 0 || calendar.recurrence.type === "none") return undefined
    const recurrence = { ...calendar.recurrence, ...(resume.count !== undefined ? { count: resume.count } : {}) },
        restarted = { ...calendar, localMinute: resume.localMinute, recurrence },
        dates: { localMinute: string; instantAt: number; offsetMinutes: number }[] = []
    // As a new calendar does, the first dates end before a later date that names no single instant, which the feature skips when it adds it
    for (let index = 0; index < CIVIL_WINDOW; index++) {
        const localMinute = civilLocalAt(restarted, index)
        if (localMinute === undefined) break
        const resolved = resolveCivil(localMinute, calendar.zone, calendar.fold)
        if (
            typeof resolved === "string" ||
            resolved.instantAt - (dates[0]?.instantAt ?? resolved.instantAt) > CIVIL_HORIZON_DAYS * CIVIL_DAY
        )
            break
        dates.push({ localMinute, ...resolved })
    }
    return { localMinute: resume.localMinute, recurrence, dates }
}
