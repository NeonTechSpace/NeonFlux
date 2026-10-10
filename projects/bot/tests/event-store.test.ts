import type { EventsContext, EventsCalendar, EventsDefinition, EventsManageRequest, EventsQueryRequest, EventsOccurrence, EventsRsvp, EventsRsvpRequest, EventsWorkRequest, EventsPromotionJob } from "@neonflux/contracts/events"
import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Redacted } from "effect"
import { createEventCalendar } from "../src/event-calendar.ts"
import { createEventsStore } from "../src/event-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { mockBackend } from "./backend-fake.ts"

const userId = "123456789012345679", botId = "123456789012345680", channelId = "123456789012345681", serverId = "123456789012345678", messageId = "123456789012345682"
const context: EventsContext = { observedAt: 1000, actor: { userId, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, channelId, botId, botAuthorized: true, actorAuthorized: true,
    member: { userId, joinedAt: "2026-01-01T00:00:00.123456789+00:00", roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } }
function event(calendar: EventsCalendar): EventsDefinition { return { eventNo: 1, name: "study", revision: 2, channelId, title: "Study", description: "", capacity: null, reminderOffsets: [1440, 60], state: "draft", participationStarted: false, calendar, createdAt: 0, updatedAt: 1000 } }
const config = { url: "https://synthetic-events.convex.cloud", secret: Redacted.make("synthetic-event-secret") }
test("calendar response binding accepts reordered object keys, rejects changed values and preserves date order", async t => {
    const calendar = createEventCalendar("2026-10-24T12:00", "Europe/Berlin", 60, "reject", { type: "daily", interval: 1, count: 3 })
    const input: EventsManageRequest = { serverId, context, messageId, createdAt: 1000, operation: { type: "calendar", eventNo: 1, expectedRevision: 1, calendar } }
    const reordered: EventsCalendar = { dates: calendar.dates.map(d => ({ offsetMinutes: d.offsetMinutes, endsAt: d.endsAt, startsAt: d.startsAt, localMinute: d.localMinute })), recurrence: { count: 3, interval: 1, type: "daily" }, durationMinutes: 60, fold: "reject", zone: calendar.zone, localMinute: calendar.localMinute }
    let response: unknown = { duplicate: false, type: "event", event: event(reordered) }
    mockBackend(t, call => { assert.equal(call.path, "/events/manage"); assert.deepEqual(call.body, input); return response })
    const store = createEventsStore(config)
    assert.deepEqual(await Effect.runPromise(store.manage(input)), response)
    response = { duplicate: false, type: "event", event: event({ ...reordered, fold: "later" }) }
    await assert.rejects(Effect.runPromise(store.manage(input)), /EventsStoreError/)
    response = { duplicate: false, type: "event", event: event({ ...reordered, dates: [...reordered.dates].reverse() }) }
    await assert.rejects(Effect.runPromise(store.manage(input)), /EventsStoreError/)
    response = { duplicate: false, type: "event", event: event({ ...reordered, recurrence: { type: "daily", interval: 2, count: 3 } }) }
    await assert.rejects(Effect.runPromise(store.manage(input)), /EventsStoreError/)
})
test("an event found by name must be the event of that name", async t => {
    const found = event(createEventCalendar("2026-10-24T12:00", "Europe/Berlin", 60)), input: EventsQueryRequest = { serverId, context, operation: { type: "show", name: "study" } }
    let response: unknown = { type: "event", event: found }
    mockBackend(t, call => { assert.equal(call.path, "/events/query"); assert.deepEqual(call.body, input); return response })
    const store = createEventsStore(config)
    assert.deepEqual(await Effect.runPromise(store.query(input)), response)
    response = { type: "event", event: { ...found, name: "other" } }
    await assert.rejects(Effect.runPromise(store.query(input)), /EventsStoreError/)
})
test("event adapter enforces source/account/occurrence binding and rejects leaked storage fields", async t => {
    const calendar = createEventCalendar("2026-10-24T12:00", "Europe/Berlin", 60)
    const occurrence: EventsOccurrence = { ...calendar.dates[0]!, eventNo: 1, occurrenceNo: 2, revision: 3, state: "open", participationStarted: true, going: 1, waitlisted: 0, capacity: 1, workGeneration: 1 }
    const rsvp: EventsRsvp = { eventNo: 1, occurrenceNo: 2, userId, joinedAt: context.member!.joinedAt, membershipGeneration: 1, revision: 1, choice: "going", allocation: "seat", acceptedCreatedAt: 1000, acceptedMessageId: messageId }
    let payload: unknown = { duplicate: false, accepted: true, occurrence, rsvp }
    const requests: string[] = []
    mockBackend(t, call => {
        requests.push(call.path)
        assert.equal(call.key, Redacted.value(deriveServiceKey(config.secret)))
        assert.ok(!JSON.stringify(call).includes("synthetic-event-secret"))
        return payload
    })
    const store = createEventsStore(config), input: EventsRsvpRequest = { serverId, context, messageId, createdAt: 1000, eventNo: 1, occurrenceNo: 2, choice: "going" }
    assert.deepEqual(await Effect.runPromise(store.rsvp(input)), payload)
    for (const changed of [{ ...rsvp, userId: botId }, { ...rsvp, joinedAt: "2026-01-01T00:00:00Z" }, { ...rsvp, acceptedMessageId: botId }, { ...rsvp, privateBody: "Synthetic forbidden" }, { ...rsvp, allocation: "waitlist" }]) {
        payload = { duplicate: false, accepted: true, occurrence, rsvp: changed }
        await assert.rejects(Effect.runPromise(store.rsvp(input)), /EventsStoreError/)
    }
    assert(requests.every(path => path === "/events/rsvp"))
})

test("promotion discovery validates bounded ordered continuation including empty scanned pages", async t => {
    const input: EventsWorkRequest = { serverId, operation: { type: "list", cursor: { eventNo: 1, occurrenceNo: 20 }, limit: 1 } }
    const job: EventsPromotionJob = { eventNo: 1, occurrenceNo: 21, revision: 2, generation: 4, nextCheckAt: 1000, channelId }
    let response: unknown = { type: "jobs", jobs: [job], nextCursor: { eventNo: 1, occurrenceNo: 21 } }
    mockBackend(t, call => {
        assert.equal(call.path, "/events/work")
        assert.deepEqual(call.body, input)
        return response
    })
    const store = createEventsStore(config)
    assert.deepEqual(await Effect.runPromise(store.work(input)), response)
    response = { type: "jobs", jobs: [], nextCursor: { eventNo: 2, occurrenceNo: 1 } }
    assert.deepEqual(await Effect.runPromise(store.work(input)), response)
    for (const invalid of [
        { type: "jobs", jobs: [job, { ...job, occurrenceNo: 22 }] },
        { type: "jobs", jobs: [{ ...job, occurrenceNo: 20 }] },
        { type: "jobs", jobs: [], nextCursor: { eventNo: 1, occurrenceNo: 20 } },
        { type: "jobs", jobs: [job], nextCursor: { eventNo: 1, occurrenceNo: 20 } },
        { type: "jobs", jobs: [job], nextCursor: { eventNo: 1, occurrenceNo: 21, privateField: true } },
    ]) {
        response = invalid
        await assert.rejects(Effect.runPromise(store.work(input)), /EventsStoreError/)
    }
})

test("multi-server event adapters preserve bound continuations and reject foreign or missing response scope", async t => {
    const input: EventsWorkRequest = { serverId, operation: { type: "member-targets", userId } }
    let nextCursor: unknown = { eventNo: 1, occurrenceNo: 20, serverId }
    mockBackend(t, call => {
        assert.equal(call.serverId, serverId)
        assert.deepEqual(call.body, input)
        return { type: "member-targets", targets: [], nextCursor }
    })
    const store = createEventsStore({ ...config, serverId, scopeMode: "multi" })
    assert.deepEqual((await Effect.runPromise(store.work(input))), { type: "member-targets", targets: [], nextCursor })
    for (const invalid of [
        { eventNo: 1, occurrenceNo: 20 },
        { eventNo: 1, occurrenceNo: 20, serverId: "123456789012345699" },
        { eventNo: 1, occurrenceNo: 20, serverId, extra: true },
    ]) {
        nextCursor = invalid
        await assert.rejects(Effect.runPromise(store.work(input)), /EventsStoreError/)
    }
})
