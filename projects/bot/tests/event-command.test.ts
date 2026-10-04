import { EVENTS_DESCRIPTION_LIMIT, type EventsDefinition, type EventsRsvp } from "@neonflux/contracts/events"
import assert from "node:assert/strict"
import test from "node:test"
import { parseEventCommand, eventHelp, eventCritical, eventPublic } from "../src/event-command.ts"
import { parseManagement } from "../src/response-command.ts"
import { createEventCalendar } from "../src/event-calendar.ts"
import { eventDetail, eventAttendeeText } from "../src/event-render.ts"

test("event grammar binds mutation revisions with explicit confirmation", () => {
    assert.deepEqual(parseEventCommand(["rsvp", "1", "2", "going"]), { type: "rsvp", eventNo: 1, occurrenceNo: 2, choice: "going" })
    assert.deepEqual(parseEventCommand(["time", "1", "2", "2026-10-25T02:30", "Europe/Berlin", "60", "later"]), { type: "time", eventNo: 1, revision: 2, localMinute: "2026-10-25T02:30", zone: "Europe/Berlin", durationMinutes: 60, fold: "later" })
    assert.deepEqual(parseEventCommand(["repeat", "1", "2", "weekly", "12", "2"]), { type: "repeat", eventNo: 1, revision: 2, recurrence: { type: "weekly", interval: 12, count: 2 } })
    assert.deepEqual(parseEventCommand(["forget", "1", "2"]), { type: "forget", eventNo: 1, revision: 2, confirmed: false })
    assert.deepEqual(parseEventCommand(["forget", "1", "2", "confirm"]), { type: "forget", eventNo: 1, revision: 2, confirmed: true })
    assert.deepEqual(parseEventCommand(["create", "study", "<#123456789012345681>", "Study group"]), { type: "create", name: "study", channelId: "123456789012345681", title: "Study group", description: "" })
    assert.match(eventHelp(), /!event rsvp <event> <occurrence> going\|maybe\|not-going\|none\n/)
    assert.match(eventHelp(), /IANA\/Zone/)
})
test("event grammar rejects excess input, invalid bounds and unscoped changes", () => {
    for (const args of [["capacity", "1", "1", "501"], ["capacity", "1", "1", "0"], ["reminders", "1", "1", "60", "60"], ["reminders", "1", "1", "0"], ["reminders", "1", "1", "10081"],
        ["repeat", "1", "1", "daily", "13", "2"], ["repeat", "1", "1", "daily", "1", "27"], ["rsvp", "1", "1", "going", "1"], ["rsvp", "1", "1", "yes"],
        ["forget", "1", "1", "yes"], ["module", "off", "0"], ["time", "1", "1", "2026-01-01T00:00Z", "UTC", "60"], ["time", "1", "1", "2026-01-01T00:00", "UTC", "10081"],
        ["list", "0"], ["status", "1", "private_cursor"], ["create", "Invalid", "123456789012345681", "Title"], ["attendees", "1", "1", "0"]]) assert("error" in parseEventCommand(args), args.join(" "))
    for (const name of ["event", "events"]) assert("error" in parseManagement("custom", ["create", name, "text", "Response"]))
    assert(eventCritical(parseEventCommand(["module", "off", "1"])))
    assert(eventCritical(parseEventCommand(["cancel", "1", "1"])))
    assert(eventPublic(parseEventCommand(["attendees", "1", "1"])))
    assert(!eventPublic(parseEventCommand(["publish", "1", "1"])))
})
test("an event description has the shared bound, and the longest detail reply fits one message", () => {
    const longest = "d".repeat(EVENTS_DESCRIPTION_LIMIT)
    assert.equal((parseEventCommand(["title", "1", "2", "Study", longest]) as { operation: { description: string } }).operation.description, longest)
    // An over-long description names its limit on create and on edit instead of the generic syntax hint
    const over = { error: `Keep the event description within ${EVENTS_DESCRIPTION_LIMIT} characters` }
    assert.deepEqual(parseEventCommand(["title", "1", "2", "Study", `${longest}d`]), over)
    assert.deepEqual(parseEventCommand(["create", "study", "<#123456789012345681>", "Study", `${longest}d`]), over)
    assert("error" in parseEventCommand(["create", "study", "<#123456789012345681>", "Study", "line\nbreak"]))
    const calendar = createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later")
    const e: EventsDefinition = { eventNo: 1, name: "s".repeat(32), revision: 2, channelId: "1234567890123456789", title: "t".repeat(256), description: longest, capacity: 500,
        reminderOffsets: [10079, 10080], state: "cancelled", participationStarted: true, calendar: { ...calendar, zone: "z".repeat(128), recurrence: { type: "weekly", interval: 12, count: 26 } }, cardPostNo: 1, createdAt: 0, updatedAt: 0 }
    // The detail reply is sent in 1900-character parts, and the longest one needs only one
    assert.ok(eventDetail(e, "!!!!!").length <= 1900)
})
test("event details keep the frozen zone and attendee lines keep public privacy", () => {
    const e: EventsDefinition = { eventNo: 1, name: "study", revision: 2, channelId: "123456789012345681", title: "Study", description: "Topic", capacity: 2,
        reminderOffsets: [1440, 60], state: "draft", participationStarted: false, calendar: createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later"), createdAt: 0, updatedAt: 0,
        template: { name: "notice", revision: 3, content: { content: "@everyone", embed: { color: 123, footer: { text: "Footer" }, fields: [{ name: "Topic", value: "Read" }] } } } }
    assert.match(eventDetail(e, "!"), /UTC\+01:00/)
    assert.match(eventDetail(e, "!"), /2026-10-25T01:30:00.000Z/)
    const r: EventsRsvp = { eventNo: 1, occurrenceNo: 1, userId: "123456789012345679", joinedAt: "2026-01-01T00:00:00.123456789+00:00", membershipGeneration: 3, revision: 4, choice: "going", allocation: "seat", acceptedMessageId: "123456789012345682", acceptedCreatedAt: 0 }
    assert(!eventAttendeeText(r, "123456789012345680").includes(r.joinedAt))
    assert(!eventAttendeeText(r, "123456789012345680").includes("generation"))
    assert.match(eventAttendeeText(r, r.userId), /^You: /)
})
