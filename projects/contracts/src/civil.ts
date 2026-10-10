import { Schema } from "effect"
import { Int, List, Millis } from "./common.ts"

// Exact local minutes in an IANA zone, resolved once to the instants they name. Scheduled publishing, milestones and events share these rules

const DAY = 86400000
/** An exact local minute, YYYY-MM-DDTHH:mm, that exists on the calendar, from the year 100 */
export const CivilLocalMinute = Schema.String.check(Schema.makeFilter((value: string) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return false
    const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
    return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!)).toISOString().slice(0, 16) === value
}))
/** The spelling of an IANA zone name. A milestone route may keep its stored zone without asking the zone database again */
export const CivilZoneName = Schema.String.check(Schema.makeFilter((value: string) => value.length <= 128 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)))
/** An IANA zone that the zone database of this runtime knows */
export const CivilZone = CivilZoneName.check(Schema.makeFilter((value: string) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true } catch { return false } }))
/** Local time minus UTC, in minutes */
export const CivilOffset = Int(-1440, 1440)
/** Whether a local minute is offsetMinutes ahead of the instant at */
export const civilAt = (localMinute: string, at: number, offsetMinutes: number) => Date.parse(`${localMinute}Z`) === at + offsetMinutes * 60000
/**
 * Whether resolved dates follow their recurrence: one per occurrence at its intended local minute, each instant later than the one
 * before and all within 180 days of the first. The backend also resolves each minute in the zone and keeps them in the next 180 days
 */
export function civilSeries(value: { localMinute: string, recurrence: CivilRecurrence, dates: readonly { localMinute: string }[] }, instants: readonly number[]) {
    const r = value.recurrence, step = r.type === "none" ? 0 : r.interval * (r.type === "weekly" ? 7 : 1) * DAY, first = Date.parse(`${value.localMinute}Z`)
    return value.dates.length === (r.type === "none" ? 1 : r.count) && instants.at(-1)! - instants[0]! <= 180 * DAY
        && value.dates.every((date, i) => date.localMinute === new Date(first + i * step).toISOString().slice(0, 16) && (i === 0 || instants[i]! > instants[i - 1]!))
}

/** Which instant a local minute that repeats when clocks go back names. reject refuses such a minute */
export const CivilFoldPolicy = Schema.Literals(["reject", "earlier", "later"])
export type CivilFoldPolicy = typeof CivilFoldPolicy.Type
export const CivilRecurrence = Schema.Union([Schema.Struct({ type: Schema.Literal("none") }), Schema.Struct({ type: Schema.Literals(["daily", "weekly"]), interval: Int(1, 12), count: Int(1, 26) })])
export type CivilRecurrence = typeof CivilRecurrence.Type
export const CivilResolvedDate = Schema.Struct({ localMinute: CivilLocalMinute, instantAt: Millis, offsetMinutes: CivilOffset })
    .check(Schema.makeFilter(v => civilAt(v.localMinute, v.instantAt, v.offsetMinutes)))
export type CivilResolvedDate = typeof CivilResolvedDate.Type
/** What a calendar asks for, without its resolved dates */
export const civilIntent = { localMinute: CivilLocalMinute, zone: CivilZone, fold: CivilFoldPolicy, recurrence: CivilRecurrence }
export const CivilCalendar = Schema.Struct({ ...civilIntent, dates: List(CivilResolvedDate, 26) }).check(Schema.makeFilter(v => civilSeries(v, v.dates.map(date => date.instantAt))))
export type CivilCalendar = typeof CivilCalendar.Type
