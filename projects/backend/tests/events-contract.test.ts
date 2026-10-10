import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createEventCalendar } from "../../bot/src/event-calendar.ts"
import { createEventsStore, EventsStoreError } from "../../bot/src/event-store.ts"
import { createPublishingStore, PublishingStoreError } from "../../bot/src/publishing-store.ts"

const modules = {
    "../convex/events.ts": () => import("../convex/events.ts"),
    "../convex/eventsWork.ts": () => import("../convex/eventsWork.ts"),
    "../convex/eventsDelivery.ts": () => import("../convex/eventsDelivery.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
}

const joinedAt = "2026-03-24T10:00:00.000000Z"
const actor: C.ModerationActor = { originServerId: "1", userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const owner: C.ModerationActor = { ...actor, userId: "10", isOwner: true }
const otherAdmin: C.ModerationActor = { ...actor, userId: "11", isAdministrator: true }
const member = (userId = actor.userId, epoch = joinedAt): C.EventsMemberContext => ({
    userId, joinedAt: epoch, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true,
})

// Exercise the bot's calendar builder without reproducing its civil-time rules
function calendar(localMinute = "2026-03-26T12:00", zone = "UTC", fold: C.EventsFoldPolicy = "reject",
    recurrence: C.EventsRecurrence = { type: "none" }): C.EventsCalendar {
    return createEventCalendar(localMinute, zone, 60, fold, recurrence)
}

function eventResult(result: C.EventsManageResult) {
    assert(!result.duplicate && result.type === "event")
    return result
}

function deliveryBinding(value: C.EventsDelivery): C.EventsDeliveryBinding {
    return { deliveryId: value.deliveryId, eventNo: value.eventNo, occurrenceNo: value.occurrenceNo,
        revision: value.revision, offsetMinutes: value.offsetMinutes }
}

function publishingBinding(grant: C.EventsDeliveryGrant, claimToken = "a".repeat(32)) {
    return { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation,
        sourceId: grant.sourceId, claimToken }
}

async function fixture(t: Parameters<typeof adapterFixture>[0]) {
    const f = await adapterFixture(t, modules)
    f.advance(Date.parse("2026-03-25T12:00Z") - f.now())
    const store = createEventsStore(f.config), wrongStore = createEventsStore(f.wrongConfig), publishing = createPublishingStore(f.config)
    const context = (who = owner, current = member(who.userId), channelId = "30"): C.EventsContext => ({
        observedAt: f.now(), actor: who, channelId, botId: "999", botAuthorized: true, actorAuthorized: true, member: current,
    })
    const workerContext = (locator: Pick<C.EventsDefinition, "channelId">, current = member(owner.userId)) => context(owner, current, locator.channelId)
    const automationContext = (locator: Pick<C.EventsDefinition, "channelId">): C.EventsAutomationContext =>
        ({ observedAt: f.now(), channelId: locator.channelId, botId: "999", botAuthorized: true })
    const manageInput = (operation: C.EventsManageOperation, current = context()): C.EventsManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.EventsManageOperation) => f.run<C.EventsManageResult>(store.manage(manageInput(operation)))
    const queryInput = (operation: C.EventsQueryRequest["operation"], current = context()): C.EventsQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: C.EventsQueryRequest["operation"], current = context()) => f.run<C.EventsQueryResult>(store.query(queryInput(operation, current)))
    const show = async (event: Pick<C.EventsDefinition, "eventNo">) => {
        const value = await query({ type: "show", eventNo: event.eventNo })
        assert.equal(value.type, "event")
        return value.event
    }
    const dates = async (event: Pick<C.EventsDefinition, "eventNo">) => {
        const value = await query({ type: "dates", eventNo: event.eventNo })
        assert.equal(value.type, "dates")
        return value.dates
    }
    const attendees = async (occurrence: Pick<C.EventsOccurrence, "eventNo" | "occurrenceNo">) => {
        const value = await query({ type: "attendees", eventNo: occurrence.eventNo, occurrenceNo: occurrence.occurrenceNo })
        assert.equal(value.type, "attendees")
        return value.attendees
    }
    const status = async () => {
        const value = await query({ type: "status" })
        assert.equal(value.type, "status")
        return value
    }
    const create = async (name: string, value = calendar(), capacity: number | null = null, offsets: number[] = []) => {
        let event = eventResult(await manage({ type: "create", name, title: "Synthetic event", description: "Synthetic contract fixture", channelId: "30" })).event
        event = eventResult(await manage({ type: "calendar", eventNo: event.eventNo, expectedRevision: event.revision, calendar: value })).event
        if (capacity !== null) event = eventResult(await manage({ type: "capacity", eventNo: event.eventNo, expectedRevision: event.revision, capacity })).event
        event = eventResult(await manage({ type: "reminders", eventNo: event.eventNo, expectedRevision: event.revision, offsets })).event
        return event
    }
    const enable = async () => {
        const value = await query({ type: "settings" })
        assert.equal(value.type, "settings")
        if (!value.settings.enabled) await manage({ type: "settings", expectedRevision: value.settings.revision, enabled: true })
    }
    const post = async (postNo: number) => {
        const value = await f.run<C.PublishingQueryResult>(publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo } }))
        assert.equal(value.type, "post")
        return value.post
    }
    const sent = async (grant: C.EventsDeliveryGrant) => {
        const binding = publishingBinding(grant)
        const claimed = await f.run<C.PublishingDispatchResult>(publishing.dispatch({ ...binding, eventContext: workerContext({ channelId: grant.channelId }) }))
        assert(claimed.claimed)
        assert.deepEqual(await f.run<C.PublishingOutcomeResult>(publishing.outcome({ ...binding, outcome: "sent", messageId: grant.messageId ?? f.source().messageId })), { recorded: true })
    }
    const open = async (name: string, capacity: number | null = null, offsets: number[] = []) => {
        await enable()
        const event = await create(name, calendar(), capacity, offsets)
        const published = eventResult(await manage({ type: "publish", eventNo: event.eventNo, expectedRevision: event.revision }))
        assert(published.grant)
        await sent(published.grant)
        return published.event
    }
    const rsvpInput = (occurrence: Pick<C.EventsOccurrence, "eventNo" | "occurrenceNo">, choice: C.EventsChoice, current = member()): C.EventsRsvpRequest =>
        ({ ...f.source(), context: context({ ...actor, userId: current.userId }, current), eventNo: occurrence.eventNo, occurrenceNo: occurrence.occurrenceNo, choice })
    const rsvp = (occurrence: Pick<C.EventsOccurrence, "eventNo" | "occurrenceNo">, choice: C.EventsChoice, current = member()) =>
        f.run<C.EventsRsvpResult>(store.rsvp(rsvpInput(occurrence, choice, current)))
    const work = (operation: C.EventsWorkRequest["operation"]) => f.run<C.EventsWorkResult>(store.work({ serverId: "1", operation }))
    const delivery = (operation: C.EventsDeliveryRequest["operation"]) => f.run<C.EventsDeliveryResult>(store.delivery({ serverId: "1", operation }))
    const deliveries = async (event: Pick<C.EventsDefinition, "eventNo">) => {
        const value = await delivery({ type: "status", eventNo: event.eventNo })
        assert.equal(value.type, "deliveries")
        return value.deliveries
    }
    const publishingManage = (operation: C.PublishingManageOperation) => f.run<C.PublishingManageResult>(publishing.manage({ ...f.source(), actor: owner, operation }))
    return { ...f, store, wrongStore, publishing, context, workerContext, automationContext, manageInput, manage, queryInput, query, show, dates, attendees, status,
        create, enable, post, sent, open, rsvpInput, rsvp, work, delivery, deliveries, publishingManage }
}

test("events and publishing adapters reconcile legacy omitted color while preserving uncertain audit and real drift", async t => {
    const f = await fixture(t)
    await f.enable()
    for (const scenario of [
        { name: "Legacy omission matches native zero", color: 0, drift: false, matched: true },
        { name: "Nonzero color remains real drift", color: 4023992, drift: false, matched: false },
        { name: "Real text drift remains unresolved", color: 0, drift: true, matched: false },
        { name: "Stored canonical drift is never rebuilt from authored content", color: 0, drift: false, matched: false, storedDrift: true },
    ]) await t.test(scenario.name, async () => {
        const event = await f.create(`legacy-${f.source().messageId}`)
        const published = eventResult(await f.manage({ type: "publish", eventNo: event.eventNo, expectedRevision: event.revision }))
        assert(published.grant)
        const grant = published.grant, binding = publishingBinding(grant)
        assert.equal(grant.content.embed!.color, undefined)
        assert.equal(grant.canonicalContent.embed!.color, 0)
        assert((await f.run<C.PublishingDispatchResult>(f.publishing.dispatch({ ...binding, eventContext: f.context() }))).claimed)
        const messageId = f.source().messageId
        assert.deepEqual(await f.run<C.PublishingOutcomeResult>(f.publishing.outcome({ ...binding, outcome: "uncertain", messageId })), { recorded: true })
        await f.backend.run(async ctx => {
            const attempt = (await ctx.db.query("publishingAttempts").collect()).find(row => row._id === grant.attemptId)!
            const canonicalContent = structuredClone(attempt.canonicalContent)
            delete canonicalContent.embed!.color
            if (scenario.storedDrift) canonicalContent.content = "Retained canonical drift"
            await ctx.db.patch(attempt._id, { canonicalContent })
        })
        const before = await f.backend.run(async ctx => (await ctx.db.query("publishingAttempts").collect()).find(row => row._id === grant.attemptId)!)
        if (scenario.storedDrift) await assert.rejects(f.post(grant.postNo), /PublishingStoreError/)
        else {
            const projected = await f.post(grant.postNo)
            assert.equal(projected.attempt.canonicalContent.embed!.color, 0)
            assert.equal(projected.confirmedCanonicalContent, undefined)
            assert.equal(projected.attempt.canonicalContent.content, before.canonicalContent.content)
        }
        assert.deepEqual(await f.backend.run(async ctx => (await ctx.db.query("publishingAttempts").collect()).find(row => row._id === grant.attemptId)!), before)
        f.advance(190001)
        const observed = { ...grant.content, content: scenario.drift ? "Other staff content" : grant.content.content, embed: { ...grant.content.embed!, color: scenario.color } }
        const reconcile = f.run<C.PublishingReconcileResult>(f.publishing.reconcile({ ...f.source(), actor: owner, postNo: grant.postNo, attemptId: grant.attemptId, expectedGeneration: grant.generation,
            observation: { observedAt: f.now(), messageId, channelId: grant.channelId, botId: grant.botId, content: observed } }))
        if (scenario.storedDrift) await assert.rejects(reconcile, /PublishingStoreError/)
        else {
            const reconciled = await reconcile
            assert(reconciled.recorded)
            assert.equal(reconciled.post.outcome, "uncertain")
            assert.equal(reconciled.post.attempt.outcome, "uncertain")
            assert.equal(reconciled.post.attempt.resolution?.matched, scenario.matched ? "intended" : undefined)
            assert.equal(reconciled.post.confirmedCanonicalContent?.embed?.color, scenario.matched ? 0 : undefined)
        }
        const after = await f.backend.run(async ctx => (await ctx.db.query("publishingAttempts").collect()).find(row => row._id === grant.attemptId)!)
        assert.equal(after.unresolved, !scenario.matched)
        for (const field of ["outcome", "content", "canonicalContent", "createdAt", "finishedAt", "dispatchedAt", "messageId"] as const) assert.deepEqual(after[field], before[field])
        assert.deepEqual(after.observation!.content, observed)
    })
})

test("normal event APIs reject retiming an empty started event and permit settled cancel or completed forgetting", async t => {
    const f = await fixture(t), event = await f.open("past-empty"), occurrence = (await f.dates(event))[0]!
    const completed = await f.open("completed-empty"), next = (await f.dates(completed))[0]!
    f.advance(occurrence.startsAt - f.now() + 1)
    assert.equal((await f.show(event)).state, "started")
    assert.deepEqual(await f.attendees(occurrence), [])
    await f.reject(f.store.manage(f.manageInput({ type: "calendar", eventNo: event.eventNo, expectedRevision: event.revision, calendar: calendar("2026-03-27T12:00") })), EventsStoreError, 409)
    const cancelled = eventResult(await f.manage({ type: "cancel", eventNo: event.eventNo, expectedRevision: event.revision })).event
    const forgotten = await f.manage({ type: "forget", eventNo: event.eventNo, expectedRevision: cancelled.revision, confirm: "forget" })
    assert(!forgotten.duplicate && forgotten.type === "forgotten" && forgotten.complete)
    f.advance(next.endsAt - f.now() + 1)
    assert.equal((await f.show(completed)).state, "completed")
    await f.reject(f.store.manage(f.manageInput({ type: "cancel", eventNo: completed.eventNo, expectedRevision: completed.revision })), EventsStoreError, 409)
    const removed = await f.manage({ type: "forget", eventNo: completed.eventNo, expectedRevision: completed.revision, confirm: "forget" })
    assert(!removed.duplicate && removed.type === "forgotten" && removed.complete)
})

test("events adapter authenticates all routes and round trips disabled defaults and revision-bound settings", async t => {
    const f = await fixture(t)
    assert.deepEqual(await f.query({ type: "settings" }), { type: "settings", settings: { enabled: false, revision: 1, threads: false } })
    const before = await f.status()
    assert.equal(before.definitions, 0)
    assert.equal(before.receipts, 0)
    assert.deepEqual(await f.backend.run(async ctx => ({ settings: await ctx.db.query("eventSettings").collect(), receipts: await ctx.db.query("eventReceipts").collect() })),
        { settings: [], receipts: [] })
    for (const effect of [
        f.wrongStore.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true })),
        f.wrongStore.query(f.queryInput({ type: "settings" })),
        f.wrongStore.rsvp(f.rsvpInput({ eventNo: 1, occurrenceNo: 1 }, "going")),
        f.wrongStore.work({ serverId: "1", operation: { type: "list" } }),
        f.wrongStore.delivery({ serverId: "1", operation: { type: "list" } }),
    ]) await f.reject(effect, EventsStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), EventsStoreError, 403)
    await f.reject(f.store.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true }, f.context(actor))), EventsStoreError, 403)
    assert.deepEqual(await f.status(), before)

    const input = f.manageInput({ type: "settings", expectedRevision: 1, enabled: true })
    const configured = await f.run<C.EventsManageResult>(f.store.manage(input))
    assert(!configured.duplicate && configured.type === "settings")
    assert.deepEqual(configured.settings, { enabled: true, revision: 2, threads: false })
    assert.deepEqual(await f.run<C.EventsManageResult>(f.store.manage(input)), { duplicate: true })
    const after = await f.status()
    await f.reject(f.store.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: false })), EventsStoreError, 409)
    assert.deepEqual(await f.status(), after)
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)),
        new Set(["/events/manage", "/events/query", "/events/rsvp", "/events/work", "/events/delivery"]))
})

test("events adapter validates the actual bot's finite civil calendar and rejects malformed calendars atomically", async t => {
    const f = await fixture(t)
    const expanded = calendar("2026-03-28T09:00", "Europe/Berlin", "reject", { type: "daily", interval: 1, count: 3 })
    const event = await f.create("civil-calendar", expanded)
    const dates = await f.dates(event)
    assert.deepEqual(dates.map(({ localMinute, startsAt, endsAt, offsetMinutes }) => ({ localMinute, startsAt, endsAt, offsetMinutes })), expanded.dates)
    assert.deepEqual(dates.map(date => date.offsetMinutes), [60, 120, 120])
    assert.equal(dates[1]!.startsAt - dates[0]!.startsAt, 23 * 3600000)
    const before = { event: await f.show(event), dates, status: await f.status() }
    const bad: C.EventsCalendar[] = [
        { ...expanded, zone: "Synthetic/Invalid" },
        { ...expanded, dates: expanded.dates.slice(0, 2) },
        { ...expanded, dates: expanded.dates.map((date, i) => i === 1 ? { ...date, offsetMinutes: 60 } : date) },
        { ...expanded, dates: expanded.dates.map((date, i) => i === 1 ? { ...date, endsAt: date.endsAt + 60000 } : date) },
        { ...expanded, localMinute: "2026-03-29T02:30", recurrence: { type: "none" },
            dates: [{ localMinute: "2026-03-29T02:30", startsAt: Date.parse("2026-03-29T01:30Z"), endsAt: Date.parse("2026-03-29T02:30Z"), offsetMinutes: 60 }] },
    ]
    for (const value of bad) {
        await f.reject(f.store.manage(f.manageInput({ type: "calendar", eventNo: event.eventNo, expectedRevision: event.revision, calendar: value })), EventsStoreError, 400)
        assert.deepEqual({ event: await f.show(event), dates: await f.dates(event), status: await f.status() }, before)
    }
    // Both explicit fold choices must cross the decoder/backend boundary
    f.advance(Date.parse("2026-10-23T12:00Z") - f.now())
    const earlier = calendar("2026-10-25T02:30", "Europe/Berlin", "earlier")
    const later = calendar("2026-10-25T02:30", "Europe/Berlin", "later")
    assert.equal(later.dates[0]!.startsAt - earlier.dates[0]!.startsAt, 3600000)
    for (const [name, value] of [["fold-earlier", earlier], ["fold-later", later]] as const) {
        const folded = await f.create(name, value)
        assert.equal((await f.dates(folded))[0]!.startsAt, value.dates[0]!.startsAt)
        const snapshot = await f.show(folded)
        await f.reject(f.store.manage(f.manageInput({ type: "calendar", eventNo: folded.eventNo, expectedRevision: folded.revision,
            calendar: { ...value, fold: "reject" } })), EventsStoreError, 400)
        assert.deepEqual(await f.show(folded), snapshot)
    }
})

test("events adapter preserves RSVP choices, FIFO, withdrawal fences and sticky participation", async t => {
    const f = await fixture(t)
    const event = await f.open("attendance", 1)
    let occurrence = (await f.dates(event))[0]!
    const firstInput = f.rsvpInput(occurrence, "going")
    let first = await f.run<C.EventsRsvpResult>(f.store.rsvp(firstInput))
    assert(first.accepted && first.rsvp?.allocation === "seat")
    assert.equal(first.rsvp.joinedAt, joinedAt)
    assert.equal(first.occurrence.going, 1)
    const duplicate = await f.run<C.EventsRsvpResult>(f.store.rsvp(firstInput))
    assert(duplicate.duplicate)
    assert.deepEqual(duplicate.rsvp, first.rsvp)
    let waiter = await f.rsvp(occurrence, "going", member("21"))
    assert(waiter.accepted && waiter.rsvp?.allocation === "waitlist")
    const order = waiter.rsvp.queueOrder
    const repeated = await f.rsvp(occurrence, "going", member("21"))
    assert.equal(repeated.rsvp?.queueOrder, order)
    waiter = repeated
    const oldGoing = f.rsvpInput(occurrence, "going", member())
    f.advance(1)
    first = await f.rsvp(occurrence, "maybe", member())
    assert.equal(first.rsvp?.allocation, "none")
    assert.equal(first.occurrence.going, 0)
    const snapshot = await f.attendees(occurrence)
    const stale = await f.run<C.EventsRsvpResult>(f.store.rsvp(oldGoing))
    assert.equal(stale.accepted, false)
    assert.deepEqual(stale.rsvp, first.rsvp)
    assert.deepEqual(await f.attendees(occurrence), snapshot)
    const newcomer = await f.rsvp(occurrence, "going", member("22"))
    assert.equal(newcomer.rsvp?.allocation, "waitlist")
    assert(newcomer.rsvp!.queueOrder! > order!)
    first = await f.rsvp(occurrence, "not-going", member())
    assert.equal(first.rsvp?.choice, "not-going")
    first = await f.rsvp(occurrence, "none", member())
    assert.equal(first.rsvp?.choice, "none")
    waiter = await f.rsvp(occurrence, "none", member("21"))
    waiter = await f.rsvp(occurrence, "going", member("21"))
    assert(waiter.rsvp!.queueOrder! > newcomer.rsvp!.queueOrder!)
    occurrence = waiter.occurrence
    const before = { event: await f.show(event), dates: await f.dates(event), status: await f.status() }
    await f.reject(f.store.manage(f.manageInput({ type: "calendar", eventNo: event.eventNo, expectedRevision: event.revision, calendar: calendar("2026-03-27T12:00") })), EventsStoreError, 409)
    await f.reject(f.store.rsvp({ ...f.rsvpInput(occurrence, "going", member("23")), context: f.context({ ...actor, userId: "23" }, member("23"), "31") }), EventsStoreError, 403)
    assert.deepEqual({ event: await f.show(event), dates: await f.dates(event), status: await f.status() }, before)
    const capacityEvent = await f.open("capacity-floor", 2), capacityOccurrence = (await f.dates(capacityEvent))[0]!
    await f.rsvp(capacityOccurrence, "going", member("30"))
    await f.rsvp(capacityOccurrence, "going", member("31"))
    const capacityBefore = { event: await f.show(capacityEvent), dates: await f.dates(capacityEvent), status: await f.status() }
    await f.reject(f.store.manage(f.manageInput({ type: "capacity", eventNo: capacityEvent.eventNo, expectedRevision: capacityEvent.revision, capacity: 1 })), EventsStoreError, 409)
    assert.deepEqual({ event: await f.show(capacityEvent), dates: await f.dates(capacityEvent), status: await f.status() }, capacityBefore)
})

test("events adapter discovers seated member targets without jobs and fences stale raw membership observations", async t => {
    const f = await fixture(t), event = await f.open("membership", 1), occurrence = (await f.dates(event))[0]!
    const oldMember = member("20", "2026-03-24T10:00:00.000001Z")
    const newMember = member("20", "2026-03-24T10:00:00.000002Z")
    const old = await f.rsvp(occurrence, "going", oldMember)
    assert(old.rsvp?.allocation === "seat")
    assert.deepEqual(await f.work({ type: "list" }), { type: "jobs", jobs: [] })
    const oldTargets = await f.work({ type: "member-targets", userId: oldMember.userId })
    assert(oldTargets.type === "member-targets" && oldTargets.targets.length === 1)
    const oldTarget = oldTargets.targets[0]!
    assert.equal(oldTarget.joinedAt, oldMember.joinedAt)
    assert.equal(oldTarget.membershipGeneration, old.rsvp.membershipGeneration)
    assert.equal(oldTarget.rsvpRevision, old.rsvp.revision)
    assert.equal(oldTarget.generation, old.occurrence.workGeneration)
    const rejoined = await f.rsvp(occurrence, "going", newMember)
    assert(rejoined.rsvp?.allocation === "seat")
    assert.equal(rejoined.rsvp.joinedAt, newMember.joinedAt)
    assert.equal(rejoined.rsvp.membershipGeneration, old.rsvp.membershipGeneration + 1)
    assert.equal(rejoined.occurrence.going, 1)
    const before = await f.attendees(occurrence)
    assert.equal(before.length, 1)
    const stale = await f.run<C.EventsRsvpResult>(f.store.rsvp(f.rsvpInput(occurrence, "none", oldMember)))
    assert.equal(stale.accepted, false)
    assert.deepEqual(stale.rsvp, rejoined.rsvp)
    assert.deepEqual(await f.work({ type: "observe", ...oldTarget, observedAt: f.now(), memberAbsent: true }), { type: "progress", recorded: false })
    assert.deepEqual(await f.attendees(occurrence), before)
    const currentTargets = await f.work({ type: "member-targets", userId: newMember.userId })
    assert(currentTargets.type === "member-targets" && currentTargets.targets.length === 1)
    assert.deepEqual(currentTargets.targets[0], { ...oldTarget, joinedAt: newMember.joinedAt,
        membershipGeneration: rejoined.rsvp.membershipGeneration, rsvpRevision: rejoined.rsvp.revision, generation: rejoined.occurrence.workGeneration })
    const reduced = await f.rsvp(occurrence, "none", newMember)
    assert.equal(reduced.occurrence.going, 0)
    assert.deepEqual(await f.work({ type: "member-targets", userId: newMember.userId }), { type: "member-targets", targets: [] })
    const eventBefore = await f.show(event)
    await f.reject(f.store.manage(f.manageInput({ type: "calendar", eventNo: event.eventNo, expectedRevision: eventBefore.revision, calendar: calendar("2026-03-27T12:00") })), EventsStoreError, 409)
    assert.deepEqual(await f.show(event), eventBefore)
})

test("events adapter atomically round trips protected card ownership before dispatch and blocks composer edits", async t => {
    const f = await fixture(t)
    await f.enable()
    const event = await f.create("protected-card")
    const input = f.manageInput({ type: "publish", eventNo: event.eventNo, expectedRevision: event.revision })
    const published = eventResult(await f.run<C.EventsManageResult>(f.store.manage(input)))
    assert(published.grant)
    const grant = published.grant
    assert.deepEqual(grant.source, { type: "human", messageId: input.messageId, createdAt: input.createdAt })
    assert.deepEqual(grant.provenance, { type: "event", eventNo: event.eventNo, revision: published.event.revision })
    assert.equal(grant.consumer.purpose, "card")
    assert.equal(grant.consumer.eventNo, event.eventNo)
    assert.equal(published.event.cardPostNo, grant.postNo)
    const post = await f.post(grant.postNo)
    assert.deepEqual(post.consumer, grant.consumer)
    assert.equal(post.attempt.dispatchedAt, undefined)
    for (const [key, value] of Object.entries(grant)) assert.deepEqual(post.attempt[key as keyof C.PublishingAttempt], value)
    assert.equal(post.outcome, "pending")
    assert.deepEqual(await f.run<C.EventsManageResult>(f.store.manage(input)), { duplicate: true })
    await f.sent(grant)

    let draft = await f.publishingManage({ type: "draft-create", kind: "draft", name: "independent" })
    assert(!draft.duplicate && draft.type === "draft")
    draft = await f.publishingManage({ type: "draft-update", kind: "draft", name: draft.draft.name,
        expectedRevision: draft.draft.revision, edit: { type: "content", content: "Synthetic unrelated composer draft" } })
    assert(!draft.duplicate && draft.type === "draft")
    const before = { post: await f.post(grant.postNo), event: await f.show(published.event), status: await f.status() }
    for (const operation of [
        { type: "edit", kind: "draft", name: draft.draft.name, expectedRevision: draft.draft.revision,
            postNo: grant.postNo, expectedGeneration: grant.generation,
            context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } },
        { type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation },
    ] satisfies C.PublishingManageOperation[]) {
        await f.reject(f.publishing.manage({ ...f.source(), actor: owner, operation }), PublishingStoreError, 409)
        assert.deepEqual({ post: await f.post(grant.postNo), event: await f.show(published.event), status: await f.status() }, before)
    }
})

test("events adapter reserves due timer work with a shortened publishing window and retains unknown outcomes", async t => {
    const f = await fixture(t), event = await f.open("timer-window", null, [60])
    const scheduled = await f.deliveries(event)
    assert.equal(scheduled.length, 1)
    const delivery = scheduled[0]!, binding = deliveryBinding(delivery)
    assert.equal(delivery.channelId, event.channelId)
    assert.deepEqual(await f.delivery({ type: "list" }), { type: "deliveries", deliveries: [] })
    assert.deepEqual(await f.delivery({ type: "reserve", binding, context: f.automationContext(delivery) }), { type: "reservation", status: "waiting" })
    f.advance(delivery.dueAt + 270000 - f.now())
    const due = await f.delivery({ type: "list" })
    assert(due.type === "deliveries")
    assert.equal(due.deliveries[0]!.deliveryId, delivery.deliveryId)
    const reserved = await f.delivery({ type: "reserve", binding, context: f.automationContext(delivery) })
    assert(reserved.type === "reservation" && reserved.status === "reserved")
    const grant = reserved.grant
    assert.deepEqual(grant.source, { type: "event-timer", deliveryId: delivery.deliveryId, dueAt: delivery.dueAt })
    assert.equal(grant.consumer.purpose, "reminder")
    assert.equal(grant.consumer.occurrenceNo, delivery.occurrenceNo)
    assert.equal(grant.consumer.offsetMinutes, 60)
    assert.equal(grant.dispatchExpiresAt, delivery.dueAt + 300000)
    assert.equal(grant.dispatchExpiresAt - f.now(), 30000)
    assert.equal(grant.nativeDeadlineMs, 5000)
    const post = await f.post(grant.postNo)
    assert.deepEqual(post.consumer, grant.consumer)
    assert.equal(post.attempt.dispatchExpiresAt, grant.dispatchExpiresAt)
    assert.equal(post.attempt.dispatchedAt, undefined)
    assert.equal((await f.deliveries(event))[0]!.postNo, grant.postNo)
    const claimed = await f.run<C.PublishingDispatchResult>(f.publishing.dispatch({ ...publishingBinding(grant), eventContext: f.automationContext(delivery) }))
    assert(claimed.claimed)
    assert.equal(claimed.dispatchExpiresAt, grant.dispatchExpiresAt)
    assert.equal((await f.run<C.PublishingDispatchResult>(f.publishing.dispatch({ ...publishingBinding(grant, "b".repeat(32)), eventContext: f.automationContext(delivery) }))).claimed, false)
    assert.deepEqual(await f.run<C.PublishingOutcomeResult>(f.publishing.outcome({ ...publishingBinding(grant), outcome: "uncertain" })), { recorded: true })
    const uncertain = await f.post(grant.postNo)
    assert.equal(uncertain.outcome, "uncertain")
    assert.equal(uncertain.messageId, undefined)
    assert.deepEqual(await f.delivery({ type: "reserve", binding, context: f.automationContext(delivery) }), { type: "reservation", status: "terminal" })
    const cancelled = eventResult(await f.manage({ type: "cancel", eventNo: event.eventNo, expectedRevision: event.revision })).event
    const before = { event: await f.show(cancelled), post: await f.post(grant.postNo), status: await f.status() }
    await f.reject(f.store.manage(f.manageInput({ type: "forget", eventNo: event.eventNo, expectedRevision: cancelled.revision, confirm: "forget" })), EventsStoreError, 409)
    assert.deepEqual({ event: await f.show(cancelled), post: await f.post(grant.postNo), status: await f.status() }, before)
})

test("events adapter recovers the same unclaimed timer attempt and refuses reservation after its dispatch claim", async t => {
    const f = await fixture(t), event = await f.open("timer-recovery", null, [60])
    const delivery = (await f.deliveries(event))[0]!, binding = deliveryBinding(delivery)
    f.advance(delivery.dueAt - f.now())
    const reserved = await f.delivery({ type: "reserve", binding, context: f.automationContext(delivery) })
    assert(reserved.type === "reservation" && reserved.status === "reserved")
    const snapshot = { post: await f.post(reserved.grant.postNo), status: await f.status() }
    const recovered = await f.delivery({ type: "list" })
    assert(recovered.type === "deliveries")
    assert.equal(recovered.deliveries.length, 1)
    assert.equal(recovered.deliveries[0]!.state, "reserved")
    assert.equal(recovered.deliveries[0]!.attemptId, reserved.grant.attemptId)
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(recovered.deliveries[0]!),
        context: f.automationContext(delivery) }), reserved)
    assert.deepEqual({ post: await f.post(reserved.grant.postNo), status: await f.status() }, snapshot)
    assert((await f.run<C.PublishingDispatchResult>(f.publishing.dispatch({ ...publishingBinding(reserved.grant),
        eventContext: f.automationContext(delivery) }))).claimed)
    assert.equal((await f.post(reserved.grant.postNo)).attempt.outcome, "pending")
    assert.deepEqual(await f.delivery({ type: "reserve", binding, context: f.automationContext(delivery) }),
        { type: "reservation", status: "terminal" })
    assert.deepEqual(await f.delivery({ type: "list" }), { type: "deliveries", deliveries: [] })
    assert.equal((await f.post(reserved.grant.postNo)).attempt.attemptId, reserved.grant.attemptId)
    assert.deepEqual(await f.status(), snapshot.status)
})

test("events adapter fences unclaimed timers after cancellation, module disable, revisions and due expiry", async t => {
    const f = await fixture(t)
    const events: C.EventsDefinition[] = []
    for (const name of ["timer-cancel", "timer-disable", "timer-revision", "timer-expired"]) events.push(await f.open(name, null, [60]))
    const startBoundEvent = await f.open("timer-start-bound", null, [1])
    const startBoundDelivery = (await f.deliveries(startBoundEvent))[0]!
    const deliveries = await Promise.all(events.map(event => f.deliveries(event)))
    f.advance(deliveries[0]![0]!.dueAt - f.now())
    const cancelDelivery = deliveries[0]![0]!, cancelEvent = events[0]!
    const cancelReservation = await f.delivery({ type: "reserve", binding: deliveryBinding(cancelDelivery), context: f.automationContext(cancelDelivery) })
    assert(cancelReservation.type === "reservation" && cancelReservation.status === "reserved")
    await f.manage({ type: "cancel", eventNo: cancelEvent.eventNo, expectedRevision: cancelEvent.revision })
    await f.reject(f.publishing.dispatch({ ...publishingBinding(cancelReservation.grant), eventContext: f.automationContext(cancelDelivery) }), PublishingStoreError, 409)
    assert.equal((await f.post(cancelReservation.grant.postNo)).attempt.dispatchedAt, undefined)

    const disabled = await f.manage({ type: "settings", expectedRevision: 2, enabled: false })
    assert(!disabled.duplicate && disabled.type === "settings")
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(deliveries[1]![0]!), context: f.automationContext(deliveries[1]![0]!) }), { type: "reservation", status: "waiting" })
    const paused = (await f.deliveries(events[1]!))[0]!
    assert.equal(paused.state, "blocked")
    assert.equal(paused.postNo, undefined)
    await f.manage({ type: "settings", expectedRevision: disabled.settings.revision, enabled: true })
    const changed = eventResult(await f.manage({ type: "reminders", eventNo: events[2]!.eventNo, expectedRevision: events[2]!.revision, offsets: [] })).event
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(deliveries[2]![0]!), context: f.automationContext(deliveries[2]![0]!) }), { type: "reservation", status: "terminal" })
    assert.equal((await f.show(changed)).revision, changed.revision)
    f.advance(300001)
    assert.deepEqual(await f.delivery({ type: "reserve", binding: deliveryBinding(deliveries[3]![0]!), context: f.automationContext(deliveries[3]![0]!) }), { type: "reservation", status: "skipped" })
    assert.equal((await f.deliveries(events[3]!))[0]!.postNo, undefined)
    f.advance(startBoundDelivery.startsAt - 10000 - f.now())
    const startBound = await f.delivery({ type: "reserve", binding: deliveryBinding(startBoundDelivery), context: f.automationContext(startBoundDelivery) })
    assert(startBound.type === "reservation" && startBound.status === "reserved")
    assert.equal(startBound.grant.dispatchExpiresAt, startBoundDelivery.startsAt)
    assert.equal((await f.post(startBound.grant.postNo)).attempt.dispatchExpiresAt, startBoundDelivery.startsAt)
    f.advance(10000)
    await f.reject(f.publishing.dispatch({ ...publishingBinding(startBound.grant), eventContext: f.automationContext(startBoundDelivery) }), PublishingStoreError, 409)
    assert.equal((await f.post(startBound.grant.postNo)).attempt.dispatchedAt, undefined)
})

test("events adapter round trips promotion claims, deferral and stale checkpoints without bypassing FIFO", async t => {
    const f = await fixture(t), event = await f.open("promotion", 1), occurrence = (await f.dates(event))[0]!
    const seated = await f.rsvp(occurrence, "going")
    const first = await f.rsvp(occurrence, "going", member("21"))
    await f.rsvp(occurrence, "going", member("22"))
    await f.rsvp(occurrence, "none", member())
    const listed = await f.work({ type: "list" })
    assert.equal(listed.type, "jobs")
    assert.equal(listed.jobs.length, 1)
    const job = listed.jobs[0]!, token = "c".repeat(32)
    assert.equal(job.channelId, event.channelId)
    const claim = await f.work({ type: "claim", eventNo: job.eventNo, occurrenceNo: job.occurrenceNo, revision: job.revision, generation: job.generation, claimToken: token })
    assert(claim.type === "head" && claim.claimed)
    assert.equal(claim.binding.userId, "21")
    assert.equal(claim.binding.queueOrder, first.rsvp!.queueOrder)
    assert.equal(claim.binding.rsvpRevision, first.rsvp!.revision)
    assert.equal(claim.binding.joinedAt, joinedAt)
    assert(claim.leaseExpiresAt > f.now())
    assert.deepEqual(await f.work({ type: "defer", binding: claim.binding }), { type: "progress", recorded: true })
    assert.deepEqual(await f.work({ type: "list" }), { type: "jobs", jobs: [] })
    assert.equal((await f.attendees(occurrence)).find(row => row.userId === "22")!.allocation, "waitlist")
    f.advance(60000)
    const retry = await f.work({ type: "list" })
    assert(retry.type === "jobs" && retry.jobs.length === 1)
    const next = retry.jobs[0]!
    const current = await f.work({ type: "claim", eventNo: next.eventNo, occurrenceNo: next.occurrenceNo, revision: next.revision, generation: next.generation, claimToken: "d".repeat(32) })
    assert(current.type === "head" && current.claimed)
    assert.equal(current.binding.userId, "21")
    const before = await f.attendees(occurrence)
    await f.reject(f.store.work({ serverId: "1", operation: { type: "promote", binding: claim.binding, context: f.workerContext(job, member(claim.binding.userId, claim.binding.joinedAt)) } }), EventsStoreError, 409)
    assert.deepEqual(await f.attendees(occurrence), before)
    assert.deepEqual(await f.work({ type: "promote", binding: current.binding, context: f.workerContext(next, member(current.binding.userId, current.binding.joinedAt)) }), { type: "progress", recorded: true, promoted: true })
    assert.equal((await f.attendees(occurrence)).find(row => row.userId === "21")!.allocation, "seat")
    assert.equal((await f.attendees(occurrence)).find(row => row.userId === "22")!.allocation, "waitlist")
    assert.equal((await f.dates(event))[0]!.going, 1)
})

test("events adapter explicitly forgets settled protected tracking without native message writes", async t => {
    const f = await fixture(t), event = await f.open("settled-forget", null, [])
    assert(event.cardPostNo)
    const post = await f.post(event.cardPostNo)
    assert.equal(post.outcome, "sent")
    const cancelled = eventResult(await f.manage({ type: "cancel", eventNo: event.eventNo, expectedRevision: event.revision })).event
    const forgotten = await f.manage({ type: "forget", eventNo: event.eventNo, expectedRevision: cancelled.revision, confirm: "forget" })
    assert(!forgotten.duplicate && forgotten.type === "forgotten")
    assert.equal(forgotten.eventNo, event.eventNo)
    assert.equal(forgotten.complete, true)
    assert(forgotten.removed > 0)
    await f.reject(f.store.query(f.queryInput({ type: "show", eventNo: event.eventNo })), EventsStoreError, 404)
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: post.postNo } }), PublishingStoreError, 404)
    const remaining = await f.status()
    assert.equal(remaining.definitions, 0)
    assert.equal(remaining.occurrences, 0)
    assert.equal(remaining.rsvps, 0)
})

test("events adapter permits an authorized second admin to manage and dispatch a human card", async t => {
    const f = await fixture(t), event = await f.open("second-admin")
    const input = f.manageInput({ type: "content", eventNo: event.eventNo, expectedRevision: event.revision,
        title: "Synthetic second-admin update", description: "Synthetic authorized human update" }, f.context(otherAdmin))
    assert(event.cardPostNo)
    const before = { event: await f.show(event), post: await f.post(event.cardPostNo), status: await f.status() }
    await f.reject(f.store.manage({ ...input, context: f.context({ ...otherAdmin, nativePermissionAuthorized: false }) }), EventsStoreError, 403)
    assert.deepEqual({ event: await f.show(event), post: await f.post(event.cardPostNo), status: await f.status() }, before)
    const updated = eventResult(await f.run<C.EventsManageResult>(f.store.manage(input)))
    assert(updated.grant)
    assert.equal(updated.grant.actorId, otherAdmin.userId)
    assert.equal(updated.grant.action, "edit")
    assert(updated.grant.messageId)
    assert.deepEqual(updated.grant.source, { type: "human", messageId: input.messageId, createdAt: input.createdAt })
    const binding = publishingBinding(updated.grant)
    const claim = await f.run<C.PublishingDispatchResult>(f.publishing.dispatch({ ...binding, eventContext: f.context(otherAdmin) }))
    assert(claim.claimed)
    assert.deepEqual(await f.run<C.PublishingOutcomeResult>(f.publishing.outcome({ ...binding, outcome: "sent", messageId: updated.grant.messageId })), { recorded: true })
    const post = await f.post(updated.grant.postNo)
    assert.equal(post.outcome, "sent")
    assert.equal(post.attempt.actorId, otherAdmin.userId)
    assert.equal(post.confirmedContent?.embed?.title, "Synthetic second-admin update")
})

