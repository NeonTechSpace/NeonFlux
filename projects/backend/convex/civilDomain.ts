import { CivilCalendar, type CivilFoldPolicy } from "@neonflux/contracts/civil"
import { decode, fail } from "./validation.ts"

export const CIVIL_DAY = 86400000
function civil(value: unknown) {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) fail(400, "Explicit local minute required")
    const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
    const ms = Date.UTC(year!, month! - 1, day!, hour!, minute!)
    if (new Date(ms).toISOString().slice(0, 16) !== value) fail(400, "Invalid civil date")
    return { text: value, ms }
}
function formatter(zone: unknown) {
    if (typeof zone !== "string" || zone.length > 128 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) fail(400, "IANA timezone required")
    try { return new Intl.DateTimeFormat("en-GB", { timeZone: zone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) }
    catch { fail(400, "Invalid IANA timezone") }
}
function localAt(format: Intl.DateTimeFormat, instant: number) {
    const fields = Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]))
    return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second))
}
// A late timer still sends until the next local midnight in its zone, so the cutoff follows daylight-saving changes
export function civilDayEnded(dueAt: number, zone: string, now: number) {
    if (now < dueAt) return false
    const format = formatter(zone), local = localAt(format, dueAt), midnight = (Math.floor(local / CIVIL_DAY) + 1) * CIVIL_DAY
    // Try the due time's offset, then the offset in force at that guess, and keep the earliest instant already at or past midnight
    const first = midnight - (local - dueAt), second = midnight - (localAt(format, first) - first)
    return now >= ([second, first].filter(instant => localAt(format, instant) >= midnight).sort((a, b) => a - b)[0] ?? second)
}
export function resolveCivilInstant(localMinute: string, zone: string, fold: CivilFoldPolicy) {
    const intended = civil(localMinute), format = formatter(zone), offsets = new Set<number>()
    for (let hours = -48; hours <= 48; hours += 3) {
        const instant = intended.ms + hours * 3600000
        offsets.add((localAt(format, instant) - instant) / 60000)
    }
    const candidates = [...offsets].map(offset => intended.ms - offset * 60000).filter(instant => localAt(format, instant) === intended.ms).sort((a, b) => a - b)
    if (!candidates.length) fail(400, "Nonexistent local time")
    if (candidates.length > 1 && fold === "reject") fail(400, "Ambiguous local time requires earlier or later")
    const instantAt = fold === "later" ? candidates.at(-1)! : candidates[0]!
    return { instantAt, offsetMinutes: (intended.ms - instantAt) / 60000 }
}
// The schema checks the recurrence. Each local minute must also resolve in the zone to its supplied instant, in the next 180 days
export function validateCivilCalendar(value: unknown, now = Date.now()): CivilCalendar {
    const calendar = decode(CivilCalendar, value)
    for (const date of calendar.dates) {
        const resolved = resolveCivilInstant(date.localMinute, calendar.zone, calendar.fold)
        if (date.instantAt !== resolved.instantAt || date.offsetMinutes !== resolved.offsetMinutes) fail(400, "Civil offset or UTC binding changed")
        if (resolved.instantAt <= now || resolved.instantAt > now + 180 * CIVIL_DAY) fail(400, "Calendar outside future 180-day horizon")
    }
    return calendar
}
