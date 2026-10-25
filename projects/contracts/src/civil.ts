import { Schema } from "effect"
import { Int, List, Millis } from "./common.ts"

// Exact local minutes in an IANA zone, resolved once to the instants they name. Scheduled publishing, milestones and events share these rules

const DAY = 86400000
/** An exact local minute, YYYY-MM-DDTHH:mm, that exists on the calendar, from the year 100 */
export const CivilLocalMinute = Schema.String.check(
    Schema.makeFilter((value: string) => {
        if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return false
        const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
        return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!)).toISOString().slice(0, 16) === value
    }),
)
/** The spelling of an IANA zone name. A milestone route may keep its stored zone without asking the zone database again */
export const CivilZoneName = Schema.String.check(
    Schema.makeFilter((value: string) => value.length <= 128 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)),
)
/** An IANA zone that the zone database of this runtime knows */
export const CivilZone = CivilZoneName.check(
    Schema.makeFilter((value: string) => {
        try {
            new Intl.DateTimeFormat("en", { timeZone: value })
            return true
        } catch {
            return false
        }
    }),
)
/** Local time minus UTC, in minutes */
export const CivilOffset = Int(-1440, 1440)
/** Whether a local minute is offsetMinutes ahead of the instant at */
export const civilAt = (localMinute: string, at: number, offsetMinutes: number) =>
    Date.parse(`${localMinute}Z`) === at + offsetMinutes * 60000
/** How many future dates of a repeat are stored at once, and how far ahead of now a stored date may reach */
export const CIVIL_WINDOW = 26,
    CIVIL_HORIZON_DAYS = 180
/** A calendar day, YYYY-MM-DD, that exists on the calendar, from the year 100 */
export const CivilLocalDate = Schema.String.check(
    Schema.makeFilter(
        (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) && Schema.is(CivilLocalMinute)(`${value}T00:00`),
    ),
)
/** The last local minute a calendar can name, since local minutes have four-digit years */
export const CIVIL_LAST_MINUTE = "9999-12-31T23:59"
const LAST = Date.parse(`${CIVIL_LAST_MINUTE}Z`)
/** Why a repeat cannot be stored: It asks for a date after the last local minute a calendar can name */
export const CIVIL_RANGE_REASON = "A date of this repeat would fall after 9999-12-31, the last date a calendar supports"
const civilStep = (r: Exclude<CivilRecurrence, { type: "none" }>) => r.interval * (r.type === "weekly" ? 7 : 1) * DAY
/**
 * The local minute of a repeat's date by its index from the first, or undefined once the repeat has ended. A repeat without an
 * end date ends after the last local minute a calendar can name
 */
export function civilLocalAt(value: { localMinute: string; recurrence: CivilRecurrence }, index: number) {
    const r = value.recurrence
    if (index > 0 && (r.type === "none" || (r.count !== undefined && index >= r.count))) return undefined
    const at = Date.parse(`${value.localMinute}Z`) + (r.type === "none" ? 0 : index * civilStep(r))
    if (!(at <= LAST)) return undefined
    const local = new Date(at).toISOString().slice(0, 16)
    return r.type !== "none" && r.until !== undefined && local.slice(0, 10) > r.until ? undefined : local
}
/**
 * Whether a repeat asks for a date after the last local minute a calendar can name: The last date of a count, or the second
 * date of a repeat that ends never. A repeat with an end date stops at it instead
 */
export function civilPastRange(value: { localMinute: string; recurrence: CivilRecurrence }) {
    const r = value.recurrence
    if (r.type === "none" || r.until !== undefined || r.count === 1) return false
    return !(Date.parse(`${value.localMinute}Z`) + ((r.count ?? 2) - 1) * civilStep(r) <= LAST)
}
/**
 * Whether resolved dates are the first dates of their recurrence: one per date from the first at its intended local minute, each
 * instant later than the one before, all within the repeat's end and within 180 days of the first. The backend also resolves
 * each minute in the zone and keeps them in the future. Later dates are added by the backend as these pass
 */
export function civilSeries(
    value: { localMinute: string; recurrence: CivilRecurrence; dates: readonly { localMinute: string }[] },
    instants: readonly number[],
) {
    return (
        value.dates.length >= 1 &&
        (value.recurrence.type !== "none" || value.dates.length === 1) &&
        instants.at(-1)! - instants[0]! <= CIVIL_HORIZON_DAYS * DAY &&
        value.dates.every(
            (date, i) => date.localMinute === civilLocalAt(value, i) && (i === 0 || instants[i]! > instants[i - 1]!),
        )
    )
}
/** How often a repeat runs, such as every week or every 2 days */
export const civilEvery = (r: Exclude<CivilRecurrence, { type: "none" }>) =>
    `every ${r.interval === 1 ? "" : `${r.interval} `}${r.type === "weekly" ? "week" : "day"}${r.interval === 1 ? "" : "s"}`
/** A repeat in short, such as Once, Every week, 40 dates or Every 2 days until 2027-03-01 */
export function civilRepeatText(r: CivilRecurrence) {
    if (r.type === "none" || r.count === 1) return "Once"
    const every = civilEvery(r).replace("every", "Every")
    return r.count !== undefined
        ? `${every}, ${r.count} dates`
        : r.until
          ? `${every} until ${r.until}`
          : `${every}, no end date`
}

/** Which instant a local minute that repeats when clocks go back names. reject refuses such a minute */
export const CivilFoldPolicy = Schema.Literals(["reject", "earlier", "later"])
export type CivilFoldPolicy = typeof CivilFoldPolicy.Type
/** A repeat ends after count dates, after the local day until, or never when it has neither */
export const CivilRecurrence = Schema.Union([
    Schema.Struct({ type: Schema.Literal("none") }),
    Schema.Struct({
        type: Schema.Literals(["daily", "weekly"]),
        interval: Int(1),
        count: Schema.optionalKey(Int(1)),
        until: Schema.optionalKey(CivilLocalDate),
    }).check(Schema.makeFilter((v) => v.count === undefined || v.until === undefined)),
])
export type CivilRecurrence = typeof CivilRecurrence.Type
export const CivilResolvedDate = Schema.Struct({
    localMinute: CivilLocalMinute,
    instantAt: Millis,
    offsetMinutes: CivilOffset,
}).check(Schema.makeFilter((v) => civilAt(v.localMinute, v.instantAt, v.offsetMinutes)))
export type CivilResolvedDate = typeof CivilResolvedDate.Type
/** A later date the backend did not add because its local time does not exist, or repeats while the fold policy is reject */
export const CivilSkipped = Schema.Struct({
    localMinute: CivilLocalMinute,
    reason: Schema.Literals(["nonexistent", "ambiguous"]),
})
export type CivilSkipped = typeof CivilSkipped.Type
/**
 * Where a change to a repeat whose first date has started continues: The next date of its plan that has not started, and how
 * many dates are left from there when the repeat ends after a count, 0 once all of them have started
 */
export const CivilResume = Schema.Struct({ localMinute: CivilLocalMinute, count: Schema.optionalKey(Int(0)) })
export type CivilResume = typeof CivilResume.Type
/** What a calendar asks for, without its resolved dates */
export const civilIntent = {
    localMinute: CivilLocalMinute,
    zone: CivilZone,
    fold: CivilFoldPolicy,
    recurrence: CivilRecurrence,
}
export const CivilCalendar = Schema.Struct({ ...civilIntent, dates: List(CivilResolvedDate, CIVIL_WINDOW) }).check(
    Schema.makeFilter((v) =>
        civilSeries(
            v,
            v.dates.map((date) => date.instantAt),
        ),
    ),
)
export type CivilCalendar = typeof CivilCalendar.Type
