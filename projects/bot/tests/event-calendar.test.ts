import assert from "node:assert/strict"
import test from "node:test"
import { createEventCalendar, expandEventCalendar, EventCalendarError } from "../src/event-calendar.ts"
import { expandCivilCalendar } from "../src/civil-calendar.ts"
import { createScheduleCalendar } from "../src/schedule-calendar.ts"

test("civil expansion preserves Berlin wall minutes across both DST transitions", () => {
    const spring = expandEventCalendar("2026-03-28T12:00", "Europe/Berlin", 60, "reject", { frequency: "daily", interval: 1, count: 3 })
    assert.deepEqual(spring.map(v => v.offsetMinutes), [60, 120, 120])
    assert.equal(spring[1]!.startAt - spring[0]!.startAt, 23 * 3600000)
    assert(spring.every(v => v.local.endsWith("T12:00") && v.endAt - v.startAt === 3600000))
    const autumn = expandEventCalendar("2026-10-24T12:00", "Europe/Berlin", 10080, "reject", { frequency: "daily", interval: 1, count: 3 })
    assert.deepEqual(autumn.map(v => v.offsetMinutes), [120, 60, 60])
    assert.equal(autumn[1]!.startAt - autumn[0]!.startAt, 25 * 3600000)
    assert.equal(autumn[0]!.endAt - autumn[0]!.startAt, 10080 * 60000)
})
test("original gaps and recurring gaps reject every disambiguation, folds require explicit selection", () => {
    for (const policy of ["reject", "earlier", "later"] as const) {
        assert.throws(() => expandEventCalendar("2026-03-29T02:30", "Europe/Berlin", 1, policy), /does not exist/)
        assert.throws(() => expandEventCalendar("2026-03-28T02:30", "Europe/Berlin", 1, policy, { frequency: "daily", interval: 1, count: 2 }), /does not exist/)
    }
    assert.throws(() => expandEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60), /repeats/)
    const a = expandEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "earlier")[0]!
    const b = expandEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later")[0]!
    assert.equal(b.startAt - a.startAt, 3600000)
    assert.deepEqual([a.offsetMinutes, b.offsetMinutes], [120, 60])
})
test("nonhour timezone and original invalid fields cannot pass normalization", () => {
    const value = expandEventCalendar("2026-01-02T08:15", "Asia/Kathmandu", 1)[0]!
    assert.equal(value.offsetMinutes, 345)
    assert.equal(new Date(value.startAt).toISOString(), "2026-01-02T02:30:00.000Z")
    for (const local of ["2026-02-29T12:00", "2026-04-31T12:00", "2026-13-01T12:00", "2026-01-01T24:00", "2026-01-01T12:60", "2026-01-01T12:00Z"]) assert.throws(() => expandEventCalendar(local, "Europe/Berlin", 1))
    assert.throws(() => expandEventCalendar("2026-01-01T12:00", "Invalid/Zone", 1))
})
test("calendar bounds reject indefinite repetition, overlong horizon and invalid duration", () => {
    for (const duration of [0, 10081, 1.5]) assert.throws(() => expandEventCalendar("2026-01-01T12:00", "UTC", duration))
    for (const repeat of [{ frequency: "daily" as const, interval: 0, count: 2 }, { frequency: "weekly" as const, interval: 13, count: 2 }, { frequency: "daily" as const, interval: 1, count: 27 }, { frequency: "weekly" as const, interval: 12, count: 4 }]) assert.throws(() => expandEventCalendar("2026-01-01T12:00", "UTC", 1, "reject", repeat))
    assert.equal(expandEventCalendar("2026-01-01T12:00", "UTC", 1, "reject", { frequency: "weekly", interval: 1, count: 26 }).length, 26)
})
test("the event wrapper preserves civil and schedule dates and wraps civil errors", () => {
    const repeat = { frequency: "daily" as const, interval: 1, count: 3 }, neutral = expandCivilCalendar("2026-10-24T12:00", "Europe/Berlin", "reject", repeat)
    const event = expandEventCalendar("2026-10-24T12:00", "Europe/Berlin", 60, "reject", repeat)
    assert.deepEqual(event.map(d => d.startAt), neutral.map(d => d.instantAt)); assert(event.every(d => d.endAt - d.startAt === 3600000))
    for (const local of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-29T12:00"]) assert.throws(() => expandEventCalendar(local, "Europe/Berlin", 60), EventCalendarError)
    const expanded = createScheduleCalendar("2026-03-28T09:00", "Europe/Berlin", "reject", { type: "daily", interval: 1, count: 3 })
    const calendar = createEventCalendar(expanded.localMinute, expanded.zone, 60, expanded.fold, expanded.recurrence)
    assert.deepEqual(calendar.dates.map(({ localMinute, startsAt, offsetMinutes }) => ({ localMinute, dueAt: startsAt, offsetMinutes })), expanded.dates)
    assert(calendar.dates.every(value => value.endsAt - value.startsAt === 3600000))
    assert.throws(() => createEventCalendar("2026-03-29T02:30", "Europe/Berlin", 60), EventCalendarError)
})
