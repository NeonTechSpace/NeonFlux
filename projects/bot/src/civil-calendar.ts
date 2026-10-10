import { DateTime } from "effect"
import type * as C from "@neonflux/backend/contracts"

export type CivilFoldPolicy = C.CivilFoldPolicy
export type CivilRepeat = { frequency: "daily" | "weekly", interval: number, count: number }
export class CivilCalendarError extends Error {}

function civil(local: string): DateTime.DateTime.Parts {
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(local)
    if (!match) throw new CivilCalendarError("Use an exact local minute: YYYY-MM-DDTHH:mm")
    const [year, month, day, hour, minute] = match.slice(1).map(Number)
    const parts = { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: 0, millisecond: 0 }
    if (parts.year < 100 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59
        || !same(parts, DateTime.toPartsUtc(DateTime.makeUnsafe(parts)))) throw new CivilCalendarError("That date or time does not exist on the calendar")
    return parts
}
function same(a: DateTime.DateTime.Parts, b: DateTime.DateTime.Parts) {
    return (Object.keys(a) as (keyof DateTime.DateTime.Parts)[]).every(key => a[key] === b[key])
}
function minute(parts: DateTime.DateTime.Parts) {
    const pad = (n: number, width = 2) => String(n).padStart(width, "0")
    return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

// Civil arithmetic happens on an unzoned calendar. Never validate an already normalized zoned date.
export function expandCivilCalendar(local: string, zone: string, foldPolicy: CivilFoldPolicy = "reject", repeat?: CivilRepeat): C.CivilResolvedDate[] {
    if (!["reject", "earlier", "later"].includes(foldPolicy)) throw new CivilCalendarError("Choose reject, earlier or later for repeated local minutes")
    if (repeat && (!["daily", "weekly"].includes(repeat.frequency) || !Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > 12
        || !Number.isInteger(repeat.count) || repeat.count < 1 || repeat.count > 26)) throw new CivilCalendarError("Repeat daily or weekly, interval 1 through 12, at most 26 dates")
    const original = DateTime.makeUnsafe(civil(local))
    let timeZone: DateTime.TimeZone.Named
    try { timeZone = DateTime.zoneMakeNamedUnsafe(zone) } catch { throw new CivilCalendarError("Use a valid IANA timezone") }
    const intended = Array.from({ length: repeat?.count ?? 1 }, (_, index) => DateTime.toPartsUtc(DateTime.add(original,
        { days: index * (repeat?.interval ?? 1) * (repeat?.frequency === "weekly" ? 7 : 1) })))
    const values = intended.map(parts => {
        const earlier = DateTime.makeZonedUnsafe(parts, { timeZone, adjustForTimeZone: true, disambiguation: "earlier" })
        const later = DateTime.makeZonedUnsafe(parts, { timeZone, adjustForTimeZone: true, disambiguation: "later" })
        if (!same(parts, DateTime.toParts(earlier)) || !same(parts, DateTime.toParts(later))) throw new CivilCalendarError(`${minute(parts)} does not exist in ${zone}. Choose another minute`)
        if (DateTime.toEpochMillis(earlier) !== DateTime.toEpochMillis(later) && foldPolicy === "reject") throw new CivilCalendarError(`${minute(parts)} repeats in ${zone}. Choose earlier or later explicitly`)
        const resolved = foldPolicy === "later" ? later : earlier
        const startAt = DateTime.toEpochMillis(resolved)
        const civilAt = DateTime.toEpochMillis(DateTime.makeUnsafe(parts))
        return { localMinute: minute(parts), offsetMinutes: (civilAt - startAt) / 60000, instantAt: startAt }
    })
    if (values.at(-1)!.instantAt - values[0]!.instantAt > 180 * 86400000) throw new CivilCalendarError("All dates must fall within 180 days of the first")
    return values
}
