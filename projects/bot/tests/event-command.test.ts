import {
    EVENTS_DESCRIPTION_LIMIT,
    EVENTS_REMINDER_RANGE_MINUTES,
    type EventsDefinition,
    type EventsRsvp,
} from "@neonflux/contracts/events"
import { renderEmbeds, renderText } from "../src/reply-style.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { parseEventCommand, eventHelp, eventHelpAll, eventCritical, eventPublic } from "../src/event-command.ts"
import { parseManagement } from "../src/response-command.ts"
import { createEventCalendar } from "../src/event-calendar.ts"
import { eventDetail, eventAttendeeText } from "../src/event-render.ts"

const parse = (text: string) => parseEventCommand(text.split(" "))
test("event grammar names events in any case, takes no revisions and pages lists with next", () => {
    assert.deepEqual(parse("list"), { type: "list", next: false })
    assert.deepEqual(parse("list next"), { type: "list", next: true })
    assert.deepEqual(parse("show Study"), { type: "show", name: "study" })
    assert.deepEqual(parse("dates study"), { type: "dates", name: "study", next: false })
    assert.deepEqual(parse("dates study next"), { type: "dates", name: "study", next: true })
    assert.deepEqual(parse("attendees study 2 next"), { type: "attendees", name: "study", occurrenceNo: 2, next: true })
    assert.deepEqual(parse("rsvp STUDY 2 going"), { type: "rsvp", name: "study", occurrenceNo: 2, choice: "going" })
    assert.deepEqual(parse("rsvp study maybe"), { type: "rsvp", name: "study", choice: "maybe" })
    assert.deepEqual(parse("rsvp study none"), { type: "rsvp", name: "study", choice: "none" })
    assert.deepEqual(parse("mine"), { type: "mine" })
    assert.deepEqual(parse("time study 2026-10-25T02:30 Europe/Berlin 60 later"), {
        type: "time",
        name: "study",
        localMinute: "2026-10-25T02:30",
        zone: "Europe/Berlin",
        durationMinutes: 60,
        fold: "later",
    })
    // A reminder can come months ahead
    // Up to 20 reminders, such as a week, three days, a day, an hour and ten minutes before
    assert.deepEqual(parse("reminders study 10080 4320 1440 60 10"), {
        type: "change",
        name: "study",
        change: { type: "reminders", offsets: [10080, 4320, 1440, 60, 10] },
    })
    assert.deepEqual(parse("reminders study 144000"), {
        type: "change",
        name: "study",
        change: { type: "reminders", offsets: [144000] },
    })
    // A month-long challenge lasts 43200 minutes, and a year-long season 525600, which the calendar then checks
    assert.deepEqual(parse("time study 2026-11-01T00:00 UTC 43200"), {
        type: "time",
        name: "study",
        localMinute: "2026-11-01T00:00",
        zone: "UTC",
        durationMinutes: 43200,
        fold: "reject",
    })
    assert.equal(
        (parse("time study 2026-11-01T00:00 UTC 525600") as { durationMinutes: number }).durationMinutes,
        525600,
    )
    // A single date takes a reminder a year ahead, and the backend holds a repeat's to its stored dates
    assert.deepEqual(parse("reminders study 525600"), {
        type: "change",
        name: "study",
        change: { type: "reminders", offsets: [525600] },
    })
    assert.deepEqual(parse("repeat study weekly 12 2"), {
        type: "repeat",
        name: "study",
        recurrence: { type: "weekly", interval: 12, count: 2 },
    })
    // A quarterly meeting is every 13 weeks, and an interval may be any whole number from 1
    assert.deepEqual(parse("repeat study weekly 13"), {
        type: "repeat",
        name: "study",
        recurrence: { type: "weekly", interval: 13 },
    })
    assert.deepEqual(parse("repeat study daily 400 2"), {
        type: "repeat",
        name: "study",
        recurrence: { type: "daily", interval: 400, count: 2 },
    })
    assert.deepEqual(parse("repeat study off"), { type: "repeat", name: "study", recurrence: { type: "none" } })
    // A repeat ends after a number of dates, on a date, or never when no end is given
    assert.deepEqual(parse("repeat study daily 1 40"), {
        type: "repeat",
        name: "study",
        recurrence: { type: "daily", interval: 1, count: 40 },
    })
    for (const text of ["repeat study weekly 2", "repeat study weekly 2 ongoing"])
        assert.deepEqual(parse(text), { type: "repeat", name: "study", recurrence: { type: "weekly", interval: 2 } })
    assert.deepEqual(parse("repeat study weekly 1 until 2027-03-01"), {
        type: "repeat",
        name: "study",
        recurrence: { type: "weekly", interval: 1, until: "2027-03-01" },
    })
    assert.deepEqual(parse("move study 12 2026-11-02T19:00"), {
        type: "move",
        name: "study",
        occurrenceNo: 12,
        localMinute: "2026-11-02T19:00",
        fold: "reject",
    })
    assert.deepEqual(parse("move study 12 2026-10-25T02:30 later"), {
        type: "move",
        name: "study",
        occurrenceNo: 12,
        localMinute: "2026-10-25T02:30",
        fold: "later",
    })
    assert.match(eventHelpAll.join("\n"), /^!event move <name> <date> YYYY-MM-DDTHH:mm \[earlier\|later\]: /m)
    assert.deepEqual(parseEventCommand(["title", "study", "Study group", "Bring questions"]), {
        type: "change",
        name: "study",
        change: { type: "content", title: "Study group", description: "Bring questions" },
    })
    assert.deepEqual(parse("template study notice"), {
        type: "change",
        name: "study",
        change: { type: "template", templateName: "notice" },
    })
    assert.deepEqual(parse("template study off"), {
        type: "change",
        name: "study",
        change: { type: "template", templateName: null },
    })
    // Seats go past 500, as many as the server needs
    assert.deepEqual(parse("capacity study 2000"), {
        type: "change",
        name: "study",
        change: { type: "capacity", capacity: 2000 },
    })
    assert.deepEqual(parse("capacity study off"), {
        type: "change",
        name: "study",
        change: { type: "capacity", capacity: null },
    })
    assert.deepEqual(parse("reminders study 1440 60"), {
        type: "change",
        name: "study",
        change: { type: "reminders", offsets: [1440, 60] },
    })
    assert.deepEqual(parse("reminders study off"), {
        type: "change",
        name: "study",
        change: { type: "reminders", offsets: [] },
    })
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
    assert.deepEqual(parse("threads on"), { type: "threads", enabled: true })
    assert.deepEqual(parse("threads off"), { type: "threads", enabled: false })
    assert.deepEqual(parseEventCommand(["create", "Study", "<#123456789012345681>", "Study group"]), {
        type: "create",
        name: "study",
        channelId: "123456789012345681",
        title: "Study group",
        description: "",
    })
    assert.match(
        eventHelp(),
        /^!event rsvp <name> \[date\] going\|maybe\|not-going\|none: Answer for the next open date, or one date by its number$/m,
    )
    assert.match(eventHelpAll.join("\n"), /^!event mine: Your Going and Maybe answers for events here$/m)
    assert.match(eventHelp(), /Europe\/Berlin/)
    assert.match(eventHelpAll.join("\n"), /^!event reminders /m)
    assert.doesNotMatch([eventHelp(), ...eventHelpAll].join("\n"), /revision|page|tracked|frozen|UTC/)
})
test("event grammar rejects excess input, invalid bounds and the old revision, page and cursor forms", () => {
    for (const text of [
        "capacity study 1.5",
        "capacity study 0",
        "reminders study 60 60",
        `reminders study ${Array.from({ length: 21 }, (_, i) => i + 1).join(" ")}`,
        "reminders study 0",
        `reminders study ${EVENTS_REMINDER_RANGE_MINUTES + 1}`,
        "repeat study daily 0 2",
        "repeat study daily 9007199254740992 2",
        "repeat study daily 1 0",
        "repeat study daily 1 until 2027-02-30",
        "repeat study daily 1 until",
        "repeat study daily 1 2 3",
        "move study 0 2026-11-02T19:00",
        "move study 12",
        "move study 12 2026-11-02",
        "move study 12 2026-11-02T19:00 sideways",
        "rsvp study 1 going 1",
        "rsvp study 1 yes",
        "rsvp study yes",
        "rsvp study 1",
        "rsvp study 0 going",
        "rsvp study maybe going",
        "mine study",
        "forget study yes",
        "time study 2026-01-01T00:00Z UTC 60",
        "attendees study 1 0",
        "show bad.name",
        "create bad.name 123456789012345681 Title",
        "list 3",
        "dates study 2",
        "status study 2",
        "attendees study 1 123456789012345679",
        "module on 1",
        "threads off 4",
        "threads maybe",
        "publish study 3",
        "capacity study 2 5",
        "time study 2 2026-11-01T18:00 Europe/Berlin 60",
        "template study 2 notice 3",
        "forget study 2 confirm",
        "reconcile study 2 3",
    ])
        assert("error" in parse(text), text)
    assert("error" in parseManagement("custom", ["create", "event", "text", "Response"]))
    assert(eventCritical(parse("module off")))
    assert(!eventCritical(parse("module on")))
    assert(eventCritical(parse("cancel study")))
    assert(eventCritical(parse("status study next")))
    assert(eventPublic(parse("attendees study 1")))
    assert(eventPublic(parse("mine")))
    assert(eventPublic(parse("rsvp study going")))
    assert(!eventPublic(parse("publish study")))
})
test("an event description has the shared bound, and the longest detail reply fits one message in either style", () => {
    const longest = "d".repeat(EVENTS_DESCRIPTION_LIMIT)
    assert.equal(
        (parseEventCommand(["title", "study", "Study", longest]) as { change: { description: string } }).change
            .description,
        longest,
    )
    // An over-long description names its limit on create and on edit instead of the generic syntax hint
    const over = { error: `Keep the event description within ${EVENTS_DESCRIPTION_LIMIT} characters` }
    assert.deepEqual(parseEventCommand(["title", "study", "Study", `${longest}d`]), over)
    assert.deepEqual(parseEventCommand(["create", "study", "<#123456789012345681>", "Study", `${longest}d`]), over)
    assert("error" in parseEventCommand(["create", "study", "<#123456789012345681>", "Study", "line\nbreak"]))
    const calendar = createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later")
    const e: EventsDefinition = {
        eventNo: 1,
        name: "s".repeat(32),
        revision: 2,
        channelId: "1234567890123456789",
        postId: "1234567890123456788",
        title: "t".repeat(256),
        description: longest,
        capacity: 500,
        reminderOffsets: [10079, 10080],
        state: "cancelled",
        participationStarted: true,
        calendar: { ...calendar, zone: "z".repeat(128), recurrence: { type: "weekly", interval: 12, count: 26 } },
        cardPostNo: 1,
        createdAt: 0,
        updatedAt: 0,
    }
    assert.equal(renderEmbeds(eventDetail(e, "!!!!!", 0)).length, 1)
    const replies = renderText(eventDetail(e, "!!!!!", 0))
    assert.equal(replies.length, 1)
    assert.ok((replies[0] as { content: string }).content.length <= 1900)
})
test("event details name the first date that has not ended, and none left after the last", () => {
    const calendar = createEventCalendar("2026-10-24T18:00", "UTC", 60, "reject", {
        type: "weekly",
        interval: 1,
        count: 3,
    })
    const e: EventsDefinition = {
        eventNo: 1,
        name: "study",
        revision: 2,
        channelId: "123456789012345681",
        title: "Study",
        description: "",
        capacity: null,
        reminderOffsets: [],
        state: "started",
        participationStarted: true,
        calendar,
        createdAt: 0,
        updatedAt: 0,
    }
    const nextDate = (now: number) => eventDetail(e, "!", now).fields!.find(([name]) => name === "Next date")![1]
    const [first, second, third] = calendar.dates
    assert.match(nextDate(first!.startsAt + 1), new RegExp(`^<t:${first!.startsAt / 1000}:f>`))
    assert.match(nextDate(first!.endsAt), new RegExp(`^<t:${second!.startsAt / 1000}:f>`))
    assert.match(nextDate(third!.endsAt - 1), new RegExp(`^<t:${third!.startsAt / 1000}:f>`))
    assert.equal(nextDate(third!.endsAt), "None left")
})
test("event details keep the frozen zone and attendee lines keep public privacy", () => {
    const e: EventsDefinition = {
        eventNo: 1,
        name: "study",
        revision: 2,
        channelId: "123456789012345681",
        title: "Study",
        description: "Topic",
        capacity: 2,
        reminderOffsets: [1440, 60],
        state: "draft",
        participationStarted: false,
        calendar: createEventCalendar("2026-10-25T02:30", "Europe/Berlin", 60, "later"),
        createdAt: 0,
        updatedAt: 0,
        template: {
            name: "notice",
            revision: 3,
            content: {
                content: "@everyone",
                embed: { color: 123, footer: { text: "Footer" }, fields: [{ name: "Topic", value: "Read" }] },
            },
        },
    }
    // Staff read the start and end in their own time zone, and the zone the event was planned in by name
    const start = Date.parse("2026-10-25T01:30:00Z") / 1000
    // Details name the event, show times as timestamps and print no revision to type
    const detail = eventDetail(e, "!", 0)
    assert.equal(detail.title, "Event study")
    assert.deepEqual(detail.fields, [
        ["Status", "Draft"],
        ["Channel", "<#123456789012345681>"],
        ["Next date", `<t:${start}:f> to <t:${start + 3600}:f>\nPlanned in Europe/Berlin time`],
        ["Dates", "Once"],
        ["Capacity", "2 seats"],
        ["Reminders", "1 day and 1 hour before the start"],
    ])
    assert.doesNotMatch(JSON.stringify(detail), /revision|UTC|frozen/)
    const r: EventsRsvp = {
        eventNo: 1,
        occurrenceNo: 1,
        userId: "123456789012345679",
        joinedAt: "2026-01-01T00:00:00.123456789+00:00",
        membershipGeneration: 3,
        revision: 4,
        choice: "going",
        allocation: "seat",
        acceptedMessageId: "123456789012345682",
        acceptedCreatedAt: 0,
    }
    assert.equal(eventAttendeeText(r, "123456789012345680"), "<@123456789012345679>: Going, has a seat")
    assert.equal(eventAttendeeText(r, r.userId), "You're going, and you have a seat")
    assert.equal(
        eventAttendeeText({ ...r, choice: "maybe", allocation: "waitlist", queueOrder: 2 }, r.userId),
        "You might go, and you are on the waiting list",
    )
})
