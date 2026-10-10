import assert from "node:assert/strict"
import test from "node:test"
import { parsePublishingCommand } from "../src/publishing-command.ts"
import { parseScheduleCommand, scheduleCritical } from "../src/schedule-command.ts"
import { createScheduleCalendar } from "../src/schedule-calendar.ts"
import { expandCivilCalendar, CivilCalendarError } from "../src/civil-calendar.ts"

test("nested publishing parser names schedules and sources, binds finite recurrence and selected settled forgetting", () => {
    const parsed = parsePublishingCommand(["schedule", "create", "News", "template", "Notice", "123456789012345681", "2026-10-24T12:00", "Europe/Berlin", "reject", "weekly", "1", "3"])
    assert.deepEqual(parsed, { type: "schedule", command: { type: "create", name: "news", source: { kind: "template", name: "notice" }, channelId: "123456789012345681", localMinute: "2026-10-24T12:00", zone: "Europe/Berlin", fold: "reject", recurrence: { type: "weekly", interval: 1, count: 3 } } })
    assert.deepEqual(parseScheduleCommand(["forget", "news", "3", "9", "confirm"]), { type: "forget", name: "news", occurrenceNos: [3, 9], confirmed: true })
    assert.deepEqual(parseScheduleCommand(["forget", "news"]), { type: "forget", name: "news", confirmed: false })
    assert.deepEqual(parseScheduleCommand(["update", "news", "content", "draft", "notice"]), { type: "content", name: "news", source: { kind: "draft", name: "notice" } })
    assert.deepEqual(parseScheduleCommand(["update", "news", "time", "2026-10-24T12:00", "UTC", "later", "daily", "2", "4"]), { type: "calendar", name: "news", localMinute: "2026-10-24T12:00", zone: "UTC", fold: "later", recurrence: { type: "daily", interval: 2, count: 4 } })
    assert.deepEqual(parseScheduleCommand(["update", "news", "destination", "<#123456789012345681>"]), { type: "destination", name: "news", channelId: "123456789012345681" })
    assert.deepEqual(parseScheduleCommand(["enable", "NEWS"]), { type: "enable", name: "news" })
    assert.deepEqual(parseScheduleCommand(["reconcile", "news", "7"]), { type: "reconcile", name: "news", postNo: 7 })
    assert.deepEqual(parseScheduleCommand(["show", "news"]), { type: "show", name: "news" })
    assert.deepEqual(parseScheduleCommand(["list"]), { type: "list", next: false })
    assert.deepEqual(parseScheduleCommand(["list", "next"]), { type: "list", next: true })
    assert.deepEqual(parseScheduleCommand(["status"]), { type: "status" })
    assert.deepEqual(parseScheduleCommand(["status", "news"]), { type: "deliveries", name: "news", next: false })
    assert.deepEqual(parseScheduleCommand(["status", "news", "next"]), { type: "deliveries", name: "news", next: true })
    assert.deepEqual(parseScheduleCommand(["module", "on"]), { type: "module", enabled: true })
    // Revision numbers, schedule numbers as cursors and malformed values are not forms of any command
    for (const args of [["enable", "news", "2"], ["module", "on", "1"], ["list", "3"], ["status", "news", "3"], ["reconcile", "news", "2", "1"], ["forget", "news", "3", "3", "confirm"], ["forget", "news", ...Array.from({ length: 21 }, (_, i) => String(i + 1))],
        ["update", "news", "content", "draft", "notice", "5"], ["create", "news", "draft", "notice", "2", "123456789012345681", "2026-10-24T12:00", "UTC", "reject"], ["create", "news", "draft", "notice", "123456789012345681", "2026-10-24T12:00", "UTC"],
        ["update", "news", "time", "2026-10-24T12:00", "UTC", "reject", "daily", "13", "26"], ["show", "bad name!"]]) assert("error" in parseScheduleCommand(args), JSON.stringify(args))
})
test("schedule recovery commands retain restricted-mode gating without classifying activation as recovery", () => {
    for (const args of [["disable", "news"], ["cancel", "news"], ["module", "off"], ["status"], ["status", "news"], ["list", "next"], ["show", "news"], ["reconcile", "news", "3"], ["forget", "news", "confirm"]]) assert(scheduleCritical(parseScheduleCommand(args)), JSON.stringify(args))
    for (const args of [["enable", "news"], ["module", "on"], ["update", "news", "destination", "<#123456789012345681>"]]) assert(!scheduleCritical(parseScheduleCommand(args)), JSON.stringify(args))
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
