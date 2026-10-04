import type { CivilCalendar, CivilFoldPolicy } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { fail, integer } from "./validation.ts"

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
export function validateCivilCalendar(value: unknown, now = Date.now()): CivilCalendar {
    const r = shape(value, ["localMinute", "zone", "fold", "recurrence", "dates"], ["localMinute", "zone", "fold", "recurrence", "dates"])
    const first = civil(r.localMinute)
    formatter(r.zone)
    if (!["reject", "earlier", "later"].includes(String(r.fold))) fail(400, "Invalid fold selection")
    const repeat = shape(r.recurrence, ["type", "interval", "count"], ["type"])
    if (!["none", "daily", "weekly"].includes(String(repeat.type))) fail(400, "Invalid finite recurrence")
    if (repeat.type === "none") shape(repeat, ["type"], ["type"])
    else shape(repeat, ["type", "interval", "count"], ["type", "interval", "count"])
    const count = repeat.type === "none" ? 1 : integer(repeat.count, 1, 26), interval = repeat.type === "none" ? 0 : integer(repeat.interval, 1, 12)
    if (!Array.isArray(r.dates) || r.dates.length !== count) fail(400, "Complete recurrence required")
    const dates = r.dates.map((value, index) => {
        const date = shape(value, ["localMinute", "instantAt", "offsetMinutes"], ["localMinute", "instantAt", "offsetMinutes"])
        const intended = new Date(first.ms + index * interval * (repeat.type === "weekly" ? 7 : 1) * CIVIL_DAY).toISOString().slice(0, 16)
        if (date.localMinute !== intended) fail(400, "Civil recurrence changed")
        const resolved = resolveCivilInstant(intended, r.zone as string, r.fold as CivilFoldPolicy)
        if (date.instantAt !== resolved.instantAt || date.offsetMinutes !== resolved.offsetMinutes) fail(400, "Civil offset or UTC binding changed")
        if (resolved.instantAt <= now || resolved.instantAt > now + 180 * CIVIL_DAY) fail(400, "Calendar outside future 180-day horizon")
        return { localMinute: intended, instantAt: resolved.instantAt, offsetMinutes: resolved.offsetMinutes }
    })
    if (dates.some((date, i) => i > 0 && date.instantAt <= dates[i - 1]!.instantAt)) fail(400, "Occurrences must increase")
    return { localMinute: first.text, zone: r.zone as string, fold: r.fold as CivilFoldPolicy, recurrence: repeat.type === "none" ? { type: "none" } : { type: repeat.type as "daily" | "weekly", interval, count }, dates }
}
