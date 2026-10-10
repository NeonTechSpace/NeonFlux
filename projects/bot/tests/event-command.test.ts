import assert from "node:assert/strict"
import test from "node:test"
import { parseEventCommand, eventHelp, eventCritical, eventPublic } from "../src/event-command.ts"
import { parseManagement } from "../src/response-command.ts"
import { createEventCalendar } from "../src/event-calendar.ts"
import { eventDetail, eventAttendeeText, renderEventContent } from "../src/event-render.ts"
import type * as C from "@neonflux/backend/contracts"

const parse = (text: string) => parseEventCommand(text.split(" "))
test("event grammar names events in any case, takes no revisions and pages lists with next", () => {
    assert.deepEqual(parse("list"), { type: "list", next: false })
    assert.deepEqual(parse("list next"), { type: "list", next: true })
    assert.deepEqual(parse("show Study"), { type: "show", name: "study" })
    assert.deepEqual(parse("dates study"), { type: "dates", name: "study", next: false })
    assert.deepEqual(parse("dates study next"), { type: "dates", name: "study", next: true })
    assert.deepEqual(parse("attendees study 2 next"), { type: "attendees", name: "study", occurrenceNo: 2, next: true })
    assert.deepEqual(parse("rsvp STUDY 2 going"), { type: "rsvp", name: "study", occurrenceNo: 2, choice: "going" })
    assert.deepEqual(parse("time study 2026-10-25T02:30 Europe/Berlin 60 later"), { type: "time", name: "study", localMinute: "2026-10-25T02:30", zone: "Europe/Berlin", durationMinutes: 60, fold: "later" })
    assert.deepEqual(parse("repeat study weekly 12 2"), { type: "repeat", name: "study", recurrence: { type: "weekly", interval: 12, count: 2 } })
    assert.deepEqual(parse("repeat study off"), { type: "repeat", name: "study", recurrence: { type: "none" } })
    assert.deepEqual(parseEventCommand(["title", "study", "Study group", "Bring questions"]), { type: "change", name: "study", change: { type: "content", title: "Study group", description: "Bring questions" } })
    assert.deepEqual(parse("template study notice"), { type: "change", name: "study", change: { type: "template", templateName: "notice" } })
    assert.deepEqual(parse("template study off"), { type: "change", name: "study", change: { type: "template", templateName: null } })
    assert.deepEqual(parse("capacity study off"), { type: "change", name: "study", change: { type: "capacity", capacity: null } })
    assert.deepEqual(parse("reminders study 1440 60"), { type: "change", name: "study", change: { type: "reminders", offsets: [1440, 60] } })
    assert.deepEqual(parse("reminders study off"), { type: "change", name: "study", change: { type: "reminders", offsets: [] } })
    assert.deepEqual(parse("publish study"), { type: "change", name: "study", change: { type: "publish" } })
    assert.deepEqual(parse("cancel study"), { type: "change", name: "study", change: { type: "cancel" } })
    assert.deepEqual(parse("status"), { type: "status" })
    assert.deepEqual(parse("status study"), { type: "delivery-status", name: "study", next: false })
    assert.deepEqual(parse("status study next"), { type: "delivery-status", name: "study", next: true })
    assert.deepEqual(parse("reconcile study"), { type: "reconcile", name: "study" })
    assert.deepEqual(parse("reconcile study 3"), { type: "reconcile", name: "study", postNo: 3 })
    assert.deepEqual(parse("forget study"), { type: "forget", name: "study", confirmed: false })
    assert.deepEqual(parse("forget study confirm"), { type: "forget", name: "study", confirmed: true })
    assert.deepEqual(parse("module on"), { type: "module", enabled: true })
    assert.deepEqual(parse("threads off"), { type: "threads", enabled: false })
    assert.deepEqual(parseEventCommand(["create", "Study", "<#123456789012345681>", "Study group"]), { type: "create", name: "study", channelId: "123456789012345681", title: "Study group", description: "" })
    assert.match(eventHelp(), /!event rsvp <name> <occurrence> going\|maybe\|not-going\|none\n/)
    assert.match(eventHelp(), /IANA\/Zone/)
    assert.doesNotMatch(eventHelp(), /revision|page/)
})
test("event grammar rejects excess input, invalid bounds and the old revision, page and cursor forms", () => {
    for (const text of ["capacity study 501", "capacity study 0", "reminders study 60 60", "reminders study 0", "reminders study 10081", "repeat study daily 13 2", "repeat study daily 1 27",
        "rsvp study 1 going 1", "rsvp study 1 yes", "forget study yes", "time study 2026-01-01T00:00Z UTC 60", "time study 2026-01-01T00:00 UTC 10081", "attendees study 1 0",
        "show bad.name", "create bad.name 123456789012345681 Title", "list 3", "dates study 2", "status study 2", "attendees study 1 123456789012345679", "module on 1", "threads off 4",
        "publish study 3", "capacity study 2 5", "time study 2 2026-11-01T18:00 Europe/Berlin 60", "template study 2 notice 3", "forget study 2 confirm", "reconcile study 2 3"])
        assert("error" in parse(text), text)
    assert("error" in parseManagement("custom", ["create", "event", "text", "Response"]))
    assert(eventCritical(parse("module off")))
    assert(!eventCritical(parse("module on")))
    assert(eventCritical(parse("cancel study")))
    assert(eventCritical(parse("status study next")))
    assert(eventPublic(parse("attendees study 1")))
    assert(!eventPublic(parse("publish study")))
})
test("event rendering retains exact template fields, frozen zone and public attendee privacy", () => {
    const e: C.EventsDefinition = { eventNo: 1, name: "study", revision: 2, channelId: "123456789012345681", title: "Study", description: "Topic", capacity: 2,
        reminderOffsets: [1440, 60], state: "draft", participationStarted: false, calendar: createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later"), createdAt: 0, updatedAt: 0,
        template: { name: "notice", revision: 3, content: { content: "@everyone", embed: { color: 123, footer: { text: "Footer" }, fields: [{ name: "Topic", value: "Read" }] } } } }
    const rendered = renderEventContent(e)
    assert.equal(rendered.embed!.color, 123)
    assert.equal(rendered.embed!.fields![0]!.name, "Topic")
    assert.match(rendered.embed!.fields![1]!.value, /UTC\+01:00/)
    assert.match(eventDetail(e, "!"), /2026-10-25T01:30:00.000Z/)
    // Details name the event and print no revision to type
    assert.match(eventDetail(e, "!"), /^Event study: Study\n[^]*All dates: !event dates study$/m)
    assert.doesNotMatch(eventDetail(e, "!"), /revision/)
    const r: C.EventsRsvp = { eventNo: 1, occurrenceNo: 1, userId: "123456789012345679", joinedAt: "2026-01-01T00:00:00.123456789+00:00", membershipGeneration: 3, revision: 4, choice: "going", allocation: "seat", acceptedMessageId: "123456789012345682", acceptedCreatedAt: 0 }
    assert(!eventAttendeeText(r, "123456789012345680").includes(r.joinedAt))
    assert(!eventAttendeeText(r, "123456789012345680").includes("generation"))
    assert.match(eventAttendeeText(r, r.userId), /^You: /)
    e.template!.content.embed!.fields = Array.from({ length: 23 }, () => ({ name: "F", value: "V" }))
    assert.throws(() => renderEventContent(e))
})
