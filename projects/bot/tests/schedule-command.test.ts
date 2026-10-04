import assert from "node:assert/strict"
import test from "node:test"
import { parsePublishingCommand } from "../src/publishing-command.ts"
import { parseScheduleCommand, scheduleCritical } from "../src/schedule-command.ts"
import { createScheduleCalendar } from "../src/schedule-calendar.ts"
import { expandCivilCalendar, CivilCalendarError } from "../src/civil-calendar.ts"

test("nested publishing parser binds exact source revisions, finite recurrence and selected settled forgetting", () => {
    const parsed = parsePublishingCommand(["schedule", "create", "news", "template", "notice", "4", "123456789012345681", "2026-10-24T12:00", "Europe/Berlin", "reject", "weekly", "1", "3"])
    assert.deepEqual(parsed, { type: "schedule", command: { type: "create", name: "news", source: { kind: "template", name: "notice", revision: 4 }, channelId: "123456789012345681", localMinute: "2026-10-24T12:00", zone: "Europe/Berlin", fold: "reject", recurrence: { type: "weekly", interval: 1, count: 3 } } })
    assert.deepEqual(parseScheduleCommand(["forget", "1", "2", "3", "9", "confirm"]), { type: "forget", scheduleNo: 1, expectedRevision: 2, occurrenceNos: [3, 9], confirmed: true })
    assert.deepEqual(parseScheduleCommand(["update", "1", "2", "content", "draft", "notice", "5"]), { type: "manage", operation: { type: "content", scheduleNo: 1, expectedRevision: 2, source: { kind: "draft", name: "notice", revision: 5 } } })
    for (const args of [["enable", "1", "0"], ["forget", "1", "2", "3", "3", "confirm"], ["forget", "1", "2", ...Array.from({ length: 21 }, (_, i) => String(i + 1))], ["update", "1", "2", "content", "draft", "notice", "01"], ["create", "news", "draft", "news", "2", "123456789012345681", "2026-10-24T12:00", "UTC"], ["update", "1", "2", "time", "2026-10-24T12:00", "UTC", "reject", "daily", "13", "26"]]) assert("error" in parseScheduleCommand(args), JSON.stringify(args))
})
test("schedule recovery commands retain restricted-mode gating without classifying activation as recovery", () => {
    for (const args of [["disable", "1", "2"], ["cancel", "1", "2"], ["module", "off", "1"], ["status"], ["reconcile", "1", "2", "3"], ["forget", "1", "2", "confirm"]]) assert(scheduleCritical(parseScheduleCommand(args)))
    for (const args of [["enable", "1", "2"], ["module", "on", "1"]]) assert(!scheduleCritical(parseScheduleCommand(args)))
})
test("duration-free civil results map directly to schedule due dates", () => {
    const repeat = { frequency: "daily" as const, interval: 1, count: 3 }, neutral = expandCivilCalendar("2026-10-24T12:00", "Europe/Berlin", "reject", repeat)
    const schedule = createScheduleCalendar("2026-10-24T12:00", "Europe/Berlin", "reject", { type: "daily", interval: 1, count: 3 })
    assert.deepEqual(schedule.dates, neutral.map(d => ({ localMinute: d.localMinute, dueAt: d.instantAt, offsetMinutes: d.offsetMinutes })))
    assert.deepEqual(Object.keys(neutral[0]!).sort(), ["instantAt", "localMinute", "offsetMinutes"])
    for (const local of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-29T12:00"]) assert.throws(() => expandCivilCalendar(local, "Europe/Berlin"), CivilCalendarError)
    const earlier = createScheduleCalendar("2026-10-25T02:30", "Europe/Berlin", "earlier"), later = createScheduleCalendar("2026-10-25T02:30", "Europe/Berlin", "later")
    assert.equal(later.dates[0]!.dueAt - earlier.dates[0]!.dueAt, 3600000)
    assert.throws(() => createScheduleCalendar("2026-01-01T12:00", "UTC", "reject", { type: "weekly", interval: 12, count: 4 }), /180 days/)
})
