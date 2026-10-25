import assert from "node:assert/strict"
import test from "node:test"
import { createEventCalendar } from "../src/event-calendar.ts"
import { CIVIL_RANGE_REASON } from "@neonflux/contracts/civil"
import { EventsCalendar } from "@neonflux/contracts/events"
import { Schema } from "effect"
import { CivilCalendarError, expandCivilCalendar } from "../src/civil-calendar.ts"
import { createScheduleCalendar } from "../src/schedule-calendar.ts"

test("civil expansion preserves Berlin wall minutes across both DST transitions", () => {
    const spring = createEventCalendar("2026-03-28T12:00", "Europe/Berlin", 60, "reject", {
        type: "daily",
        interval: 1,
        count: 3,
    }).dates
    assert.deepEqual(
        spring.map((v) => v.offsetMinutes),
        [60, 120, 120],
    )
    assert.equal(spring[1]!.startsAt - spring[0]!.startsAt, 23 * 3600000)
    assert(spring.every((v) => v.localMinute.endsWith("T12:00") && v.endsAt - v.startsAt === 3600000))
    const autumn = createEventCalendar("2026-10-24T12:00", "Europe/Berlin", 10080, "reject", {
        type: "daily",
        interval: 1,
        count: 3,
    }).dates
    assert.deepEqual(
        autumn.map((v) => v.offsetMinutes),
        [120, 60, 60],
    )
    assert.equal(autumn[1]!.startsAt - autumn[0]!.startsAt, 25 * 3600000)
    assert.equal(autumn[0]!.endsAt - autumn[0]!.startsAt, 10080 * 60000)
})
test("a first date in a gap is refused under every policy, a later one ends the first window, and folds need a choice", () => {
    for (const policy of ["reject", "earlier", "later"] as const) {
        assert.throws(() => createEventCalendar("2026-03-29T02:30", "Europe/Berlin", 1, policy), /does not exist/)
        // The backend skips and shows the missing date when it adds the next ones
        assert.deepEqual(
            createEventCalendar("2026-03-28T02:30", "Europe/Berlin", 1, policy, {
                type: "daily",
                interval: 1,
                count: 2,
            }).dates.map((date) => date.localMinute),
            ["2026-03-28T02:30"],
        )
    }
    // A daily 02:30 repeat across the October change keeps the dates before the repeated hour instead of refusing the repeat
    assert.deepEqual(
        createScheduleCalendar("2026-10-20T02:30", "Europe/Berlin", "reject", { type: "daily", interval: 1 }).dates.map(
            (date) => date.localMinute,
        ),
        ["2026-10-20T02:30", "2026-10-21T02:30", "2026-10-22T02:30", "2026-10-23T02:30", "2026-10-24T02:30"],
    )
    assert.equal(
        createScheduleCalendar("2026-10-20T02:30", "Europe/Berlin", "earlier", { type: "daily", interval: 1 }).dates
            .length,
        26,
    )
    assert.throws(() => createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60), /repeats/)
    const a = createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "earlier").dates[0]!
    const b = createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later").dates[0]!
    assert.equal(b.startsAt - a.startsAt, 3600000)
    assert.deepEqual([a.offsetMinutes, b.offsetMinutes], [120, 60])
})
test("nonhour timezone and original invalid fields cannot pass normalization", () => {
    const value = createEventCalendar("2026-01-02T08:15", "Asia/Kathmandu", 1).dates[0]!
    assert.equal(value.offsetMinutes, 345)
    assert.equal(new Date(value.startsAt).toISOString(), "2026-01-02T02:30:00.000Z")
    for (const local of [
        "2026-02-29T12:00",
        "2026-04-31T12:00",
        "2026-13-01T12:00",
        "2026-01-01T24:00",
        "2026-01-01T12:60",
        "2026-01-01T12:00Z",
    ])
        assert.throws(() => createEventCalendar(local, "Europe/Berlin", 1))
    assert.throws(() => createEventCalendar("2026-01-01T12:00", "Invalid/Zone", 1))
})
test("a single date may last past 180 days until the last calendar day, and a repeat's date at most 180 days", () => {
    const decode = Schema.decodeUnknownSync(EventsCalendar)
    // A season of a year is one date
    const season = createEventCalendar("2026-01-01T12:00", "UTC", 525600)
    assert.equal(season.dates[0]!.endsAt - season.dates[0]!.startsAt, 525600 * 60000)
    decode(season)
    decode(createEventCalendar("2026-01-01T12:00", "UTC", 525600, "reject", { type: "daily", interval: 1, count: 1 }))
    // Making it a repeat checks its length again, as !event repeat and the dashboard do
    for (const recurrence of [
        { type: "daily" as const, interval: 1 },
        { type: "weekly" as const, interval: 2, count: 3 },
    ])
        assert.throws(
            () => createEventCalendar("2026-01-01T12:00", "UTC", 259201, "reject", recurrence),
            (error: unknown) =>
                error instanceof CivilCalendarError &&
                error.message ===
                    "A date of a repeat lasts at most 259200 minutes (180 days), the window a repeat stores its dates in",
        )
    const repeat = createEventCalendar("2026-01-01T12:00", "UTC", 259200, "reject", { type: "daily", interval: 1 })
    decode(repeat)
    assert.throws(() =>
        decode({
            ...repeat,
            durationMinutes: 259201,
            dates: repeat.dates.map((date) => ({ ...date, endsAt: date.startsAt + 259201 * 60000 })),
        }),
    )
    // A single date ends by 9999-12-31
    decode(createEventCalendar("9999-12-30T23:59", "UTC", 1440))
    assert.throws(
        () => createEventCalendar("9999-12-30T23:59", "UTC", 1441),
        (error: unknown) =>
            error instanceof CivilCalendarError &&
            error.message === "This date would end after 9999-12-31, the last date a calendar supports",
    )
})
test("calendars store their first 26 dates within 180 days of the first, whatever the end, and reject invalid input", () => {
    // A date may last up to the 180-day window, such as a two-week game jam
    assert.equal(
        createEventCalendar("2026-01-01T12:00", "UTC", 20160).dates[0]!.endsAt -
            createEventCalendar("2026-01-01T12:00", "UTC", 20160).dates[0]!.startsAt,
        20160 * 60000,
    )
    assert.equal(createEventCalendar("2026-01-01T12:00", "UTC", 259200).dates.length, 1)
    for (const duration of [0, 1.5]) assert.throws(() => createEventCalendar("2026-01-01T12:00", "UTC", duration))
    for (const repeat of [
        { type: "daily" as const, interval: 0, count: 2 },
        { type: "weekly" as const, interval: 1.5, count: 2 },
        { type: "daily" as const, interval: 1, count: 0 },
        { type: "daily" as const, interval: 1, count: 2, until: "2026-02-01" },
        { type: "daily" as const, interval: 1, until: "2025-12-31" },
        { type: "daily" as const, interval: 1, until: "2026-02-30" },
    ])
        assert.throws(() => createEventCalendar("2026-01-01T12:00", "UTC", 1, "reject", repeat), CivilCalendarError)
    const first = (repeat: Parameters<typeof createEventCalendar>[4]) =>
        createEventCalendar("2026-01-01T12:00", "UTC", 1, "reject", repeat).dates
    // A longer repeat stores its first 26 dates, and the backend adds the rest as these pass
    assert.equal(first({ type: "daily", interval: 1, count: 27 }).length, 26)
    assert.equal(first({ type: "daily", interval: 1, count: 40 }).length, 26)
    assert.equal(first({ type: "daily", interval: 1 }).length, 26)
    assert.equal(first({ type: "weekly", interval: 1, count: 26 }).length, 26)
    // Dates more than 180 days after the first wait for the backend
    assert.deepEqual(
        first({ type: "weekly", interval: 12, count: 4 }).map((date) => date.localMinute),
        ["2026-01-01T12:00", "2026-03-26T12:00", "2026-06-18T12:00"],
    )
    // A quarterly or yearly spacing is a weekly or daily repeat with a longer interval
    assert.deepEqual(
        first({ type: "weekly", interval: 13, count: 4 }).map((date) => date.localMinute),
        ["2026-01-01T12:00", "2026-04-02T12:00"],
    )
    assert.deepEqual(
        first({ type: "daily", interval: 365 }).map((date) => date.localMinute),
        ["2026-01-01T12:00"],
    )
    assert.deepEqual(
        first({ type: "weekly", interval: 365, count: 2 }).map((date) => date.localMinute),
        ["2026-01-01T12:00"],
    )
    assert.deepEqual(
        first({ type: "daily", interval: 400, count: 2 }).map((date) => date.localMinute),
        ["2026-01-01T12:00"],
    )
    // A repeat whose dates would pass the year 9999 is refused with that reason
    for (const repeat of [
        { type: "daily" as const, interval: Number.MAX_SAFE_INTEGER },
        { type: "weekly" as const, interval: 1_000_000, count: 3 },
    ])
        assert.throws(
            () => createEventCalendar("2026-01-01T12:00", "UTC", 1, "reject", repeat),
            new CivilCalendarError(CIVIL_RANGE_REASON),
        )
    assert.deepEqual(
        first({ type: "daily", interval: 1, until: "2026-01-03" }).map((date) => date.localMinute),
        ["2026-01-01T12:00", "2026-01-02T12:00", "2026-01-03T12:00"],
    )
})
test("event dates match the civil and schedule dates, and civil errors stay civil errors", () => {
    const neutral = expandCivilCalendar("2026-10-24T12:00", "Europe/Berlin", "reject", {
        frequency: "daily",
        interval: 1,
        count: 3,
    })
    const event = createEventCalendar("2026-10-24T12:00", "Europe/Berlin", 60, "reject", {
        type: "daily",
        interval: 1,
        count: 3,
    }).dates
    assert.deepEqual(
        event.map((d) => d.startsAt),
        neutral.map((d) => d.instantAt),
    )
    assert(event.every((d) => d.endsAt - d.startsAt === 3600000))
    for (const local of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-29T12:00"])
        assert.throws(() => createEventCalendar(local, "Europe/Berlin", 60), CivilCalendarError)
    const expanded = createScheduleCalendar("2026-03-28T09:00", "Europe/Berlin", "reject", {
        type: "daily",
        interval: 1,
        count: 3,
    })
    const calendar = createEventCalendar(expanded.localMinute, expanded.zone, 60, expanded.fold, expanded.recurrence)
    assert.deepEqual(
        calendar.dates.map(({ localMinute, startsAt, offsetMinutes }) => ({
            localMinute,
            dueAt: startsAt,
            offsetMinutes,
        })),
        expanded.dates,
    )
    assert(calendar.dates.every((value) => value.endsAt - value.startsAt === 3600000))
})
