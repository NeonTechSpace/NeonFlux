import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { EventsCalendar, EventsContext, EventsChoice, EventsDeliveryGrant, EventsManageOperation, EventsPromotionBinding } from "../contracts.js"
import schema from "../convex/schema.ts"
import { resolveCivil, validateEventCalendar, EVENTS_DAY } from "../convex/eventsDomain.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-events-secret-not-a-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/events.ts": () => import("../convex/events.ts"), "../convex/eventsWork.ts": () => import("../convex/eventsWork.ts"), "../convex/eventsDelivery.ts": () => import("../convex/eventsDelivery.ts"), "../convex/eventsCleanup.ts": () => import("../convex/eventsCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/responses.ts": () => import("../convex/responses.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const joinedAt = "2025-12-01T00:00:00.000001Z"
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal(response.headers.get("cache-control"), "no-store"); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (userId = "10", join = joinedAt, channelId = "30"): EventsContext => ({ observedAt: now, actor: userId === "10" ? owner : { ...owner, userId, isOwner: false }, channelId, botId: "999", botAuthorized: true, actorAuthorized: true, member: { userId, joinedAt: join, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } })
    const http = (path: string, body: unknown, auth = true) => db.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const manage = (operation: EventsManageOperation, current = context()) => http("/events/manage", { ...source(), context: current, operation })
    const query = (operation: unknown, current = context()) => http("/events/query", { serverId: "1", context: current, operation })
    const calendar = (startsAt = now + 2 * 3600000, count = 1): EventsCalendar => ({ localMinute: new Date(startsAt).toISOString().slice(0, 16), zone: "UTC", fold: "reject", durationMinutes: 60, recurrence: count === 1 ? { type: "none" } : { type: "daily", interval: 1, count }, dates: Array.from({ length: count }, (_, i) => ({ localMinute: new Date(startsAt + i * EVENTS_DAY).toISOString().slice(0, 16), startsAt: startsAt + i * EVENTS_DAY, endsAt: startsAt + i * EVENTS_DAY + 3600000, offsetMinutes: 0 })) })
    const event = async (eventNo = 1) => (await read(await query({ type: "show", eventNo }))).event
    const dates = async (eventNo = 1) => (await read(await query({ type: "dates", eventNo }))).dates
    const change = async (operation: Record<string, unknown>, eventNo = 1) => read(await manage({ ...operation, eventNo, expectedRevision: (await event(eventNo)).revision } as EventsManageOperation))
    const enable = () => manage({ type: "settings", expectedRevision: 1, enabled: true })
    const create = async (name = "gather", startsAt = now + 2 * 3600000, capacity: number | null = 1) => {
        const e = (await read(await manage({ type: "create", name, title: "Gathering", channelId: "30" }))).event
        await change({ type: "calendar", calendar: calendar(startsAt) }, e.eventNo)
        await change({ type: "capacity", capacity }, e.eventNo)
        return e.eventNo as number
    }
    const automation = (channelId = "30") => ({ observedAt: now, channelId, botId: "999", botAuthorized: true })
    const dispatch = (grant: EventsDeliveryGrant, current: unknown = grant.consumer.purpose === "reminder" ? automation() : context()) => http("/publishing/dispatch", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), eventContext: current })
    const outcome = (grant: EventsDeliveryGrant, value = "sent", claimed = true) => http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, ...(claimed ? { claimToken: "a".repeat(32) } : {}), outcome: value, ...(value === "sent" ? { messageId: String(++sequence) } : {}) })
    const apply = async (grant: EventsDeliveryGrant) => { assert((await read(await dispatch(grant))).claimed); await read(await outcome(grant)) }
    const publish = async (eventNo = 1, settle = true) => { const value = await change({ type: "publish" }, eventNo); if (settle) await apply(value.grant); return value }
    const own = async (userId = "20", eventNo = 1) => {
        const occurrenceNo = (await dates(eventNo))[0].occurrenceNo
        let afterUserId: string | undefined
        for (let page = 0; page < 50; page++) {
            const result = await read(await query({ type: "attendees", eventNo, occurrenceNo, ...(afterUserId ? { afterUserId } : {}) }))
            const row = result.attendees.find((r: any) => r.userId === userId)
            if (row || !result.nextAfterUserId) return row
            afterUserId = result.nextAfterUserId
        }
        assert.fail("Attendee discovery exceeded its documented bound")
    }
    const rsvpRequest = async (choice: EventsChoice, userId = "20", eventNo = 1, join = joinedAt) => {
        const occurrence = (await dates(eventNo))[0]
        return { ...source(), context: context(userId, join), eventNo, occurrenceNo: occurrence.occurrenceNo, choice }
    }
    const rsvp = async (choice: EventsChoice, userId = "20", eventNo = 1, join = joinedAt) => read(await http("/events/rsvp", await rsvpRequest(choice, userId, eventNo, join)))
    const work = (operation: unknown) => http("/events/work", { serverId: "1", operation })
    const jobs = async () => (await read(await work({ type: "list" }))).jobs
    const head = async (eventNo = 1) => { const job = (await jobs()).find((j: any) => j.eventNo === eventNo); assert(job); const { nextCheckAt, channelId, ...b } = job; return read(await work({ type: "claim", ...b, claimToken: "b".repeat(32) })) }
    const promote = (binding: EventsPromotionBinding, current: EventsContext = { ...context(), member: context(binding.userId, binding.joinedAt).member! }) => work({ type: "promote", binding, context: current })
    const delivery = (operation: unknown) => http("/events/delivery", { serverId: "1", operation })
    const due = async () => (await read(await delivery({ type: "list" }))).deliveries
    const reserve = (binding: unknown, current: unknown = automation()) => delivery({ type: "reserve", binding, context: current })
    const deliveryBinding = (d: any) => ({ deliveryId: d.deliveryId, eventNo: d.eventNo, occurrenceNo: d.occurrenceNo, revision: d.revision, offsetMinutes: d.offsetMinutes })
    const cleanup = () => db.mutation(makeFunctionReference<"mutation">("eventsCleanup:cleanup"), {})
    return { db, source, context, automation, http, manage, query, calendar, event, dates, change, enable, create, dispatch, outcome, apply, publish, own, rsvpRequest, rsvp, work, jobs, head, promote, delivery, due, reserve, deliveryBinding, cleanup, advance: (ms: number) => { now += ms }, now: () => now }
}

test("Event routes authenticate, isolate servers, default disabled and reserve the command namespace", async t => {
    const f = fixture(t)
    for (const route of ["manage", "query", "rsvp", "work", "delivery"]) { await status(await f.http(`/events/${route}`, {}, false), 401); await status(await f.http(`/events/${route}`, { serverId: "2" }), 403) }
    assert.deepEqual((await read(await f.query({ type: "settings" }))).settings, { enabled: false, revision: 1 })
    assert.equal((await f.db.run(c => c.db.query("eventSettings").collect())).length, 0)
    await status(await f.manage({ type: "create", name: "gather", title: "Gather", channelId: "30" }, f.context("20")), 403)
    await status(await f.http("/responses/manage", { ...f.source(), actorId: "10", adminAuthorized: true, kind: "custom", operation: { type: "create", name: "EVENT", reply: { type: "text", text: "Collision" } } }), 400)
    await status(await f.http("/events/manage", { serverId: "1", content: "x".repeat(65536) }), 413)
})

test("Concurrent seats are transactional, FIFO is stable, withdrawal moves a re-entry to the tail and newcomers cannot bypass waiters", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    const requests = await Promise.all(["20", "21", "22"].map(u => f.rsvpRequest("going", u)))
    const values = await Promise.all(requests.map(r => f.http("/events/rsvp", r).then(read)))
    assert.deepEqual(values.map(v => v.rsvp.allocation).sort(), ["seat", "waitlist", "waitlist"])
    const seated = values.find(v => v.rsvp.allocation === "seat").rsvp.userId
    const queued = values.filter(v => v.rsvp.allocation === "waitlist").sort((a, b) => a.rsvp.queueOrder - b.rsvp.queueOrder)
    const repeated = await f.rsvp("going", queued[0].rsvp.userId); assert.equal(repeated.rsvp.queueOrder, queued[0].rsvp.queueOrder)
    await f.rsvp("none", queued[0].rsvp.userId); const reentry = await f.rsvp("going", queued[0].rsvp.userId); assert(reentry.rsvp.queueOrder > queued[1].rsvp.queueOrder)
    await f.rsvp("none", seated); assert.equal((await f.rsvp("going", "23")).rsvp.allocation, "waitlist")
    const h = await f.head(); assert.equal(h.binding.userId, queued[1].rsvp.userId); assert.equal((await read(await f.promote(h.binding))).promoted, true)
    assert.equal((await f.dates())[0].going, 1)
})

test("Old source intent, membership generations, duplicate receipts and sticky participation survive withdrawal and rejoin", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    const delayed = await f.rsvpRequest("going"); f.advance(1)
    const withdrawn = await f.rsvp("none"); assert.equal(withdrawn.rsvp.choice, "none")
    assert.equal((await read(await f.http("/events/rsvp", { ...delayed, context: f.context("20") }))).accepted, false)
    const request = await f.rsvpRequest("going"); await read(await f.http("/events/rsvp", request)); assert.equal((await read(await f.http("/events/rsvp", request))).duplicate, true)
    const newJoin = new Date(f.now()).toISOString(); f.advance(1)
    const rejoined = await f.rsvp("going", "20", 1, newJoin); assert.equal(rejoined.rsvp.membershipGeneration, 2); assert.equal(rejoined.occurrence.going, 1)
    const stale = await f.rsvpRequest("none"); assert.equal((await read(await f.http("/events/rsvp", stale))).accepted, false)
    await f.rsvp("none", "20", 1, newJoin)
    await status(await f.manage({ type: "calendar", eventNo: 1, expectedRevision: (await f.event()).revision, calendar: f.calendar(f.now() + 4 * 3600000) }), 409)
    assert((await f.event()).participationStarted)
})

test("Civil validation rejects gaps, unselected folds, normalized inputs, incomplete recurrence and offset forgery", t => {
    fixture(t)
    const berlin = (localMinute: string, startsAt: string, offsetMinutes: number, fold: EventsCalendar["fold"] = "reject"): EventsCalendar => ({ localMinute, zone: "Europe/Berlin", fold, durationMinutes: 60, recurrence: { type: "none" }, dates: [{ localMinute, startsAt: Date.parse(startsAt), endsAt: Date.parse(startsAt) + 3600000, offsetMinutes }] })
    assert.equal(validateEventCalendar(berlin("2026-03-28T12:00", "2026-03-28T11:00:00Z", 60)).dates[0]!.startsAt, Date.parse("2026-03-28T11:00Z"))
    assert.throws(() => validateEventCalendar(berlin("2026-03-29T02:30", "2026-03-29T01:30:00Z", 120)))
    assert.throws(() => resolveCivil("2026-10-25T02:30", "Europe/Berlin", "reject"))
    assert.deepEqual(resolveCivil("2026-10-25T02:30", "Europe/Berlin", "earlier"), { startsAt: Date.parse("2026-10-25T00:30Z"), offsetMinutes: 120 })
    assert.deepEqual(resolveCivil("2026-10-25T02:30", "Europe/Berlin", "later"), { startsAt: Date.parse("2026-10-25T01:30Z"), offsetMinutes: 60 })
    assert.deepEqual(resolveCivil("2026-04-01T12:00", "Asia/Kathmandu", "reject"), { startsAt: Date.parse("2026-04-01T06:15Z"), offsetMinutes: 345 })
    assert.throws(() => resolveCivil("2026-04-01T12:00", "Invalid/Synthetic", "reject"))
    const two = { ...berlin("2026-03-28T12:00", "2026-03-28T11:00:00Z", 60), recurrence: { type: "daily", interval: 1, count: 2 }, dates: [berlin("2026-03-28T12:00", "2026-03-28T11:00:00Z", 60).dates[0]!, berlin("2026-03-29T12:00", "2026-03-29T10:00:00Z", 120).dates[0]!] } as EventsCalendar
    assert.equal(validateEventCalendar(two).dates.length, 2)
    assert.throws(() => validateEventCalendar({ ...two, dates: [two.dates[0]] }))
    assert.throws(() => validateEventCalendar({ ...two, dates: [two.dates[0], { ...two.dates[1], localMinute: "2026-03-29T13:00" }] }))
    assert.throws(() => validateEventCalendar({ ...two, dates: [{ ...two.dates[0], offsetMinutes: 120 }, two.dates[1]] }))
})

test("Promotion leases bind exact RSVP revisions, known ineligible heads defer and ambiguous heads do not starve other events", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish(); await f.create("second"); await f.publish(2)
    for (const eventNo of [1, 2]) { await f.rsvp("going", "20", eventNo); await f.rsvp("going", "21", eventNo); await f.rsvp("going", "22", eventNo); await f.rsvp("none", "20", eventNo) }
    const first = await f.head(); await read(await f.work({ type: "defer", binding: first.binding })); assert.deepEqual((await f.jobs()).map((j: any) => j.eventNo), [2])
    const second = await f.head(2); const blocked = { ...f.context(), member: f.context("21").member! }; blocked.member.canView = false
    assert.equal((await read(await f.promote(second.binding, blocked))).promoted, false)
    const next = await f.head(2); assert.equal(next.binding.userId, "22"); await f.rsvp("none", "22", 2)
    await status(await f.promote(next.binding), 409)
    f.advance(60000); const recovered = await f.head(1); assert.equal((await read(await f.promote(recovered.binding))).promoted, true)
})

test("Timer reservation atomically owns a protected post and immutable attempt, shortens deadlines and never replays uncertain sends", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create("gather", f.now() + 120000)
    await f.change({ type: "reminders", offsets: [1] }); await f.publish(); assert.deepEqual(await f.due(), [])
    f.advance(60000); const d = (await f.due())[0], b = f.deliveryBinding(d), r = await read(await f.reserve(b)), grant = r.grant
    assert.equal(grant.source.type, "event-timer"); assert.equal(grant.dispatchExpiresAt, f.now() + 60000); assert.equal(grant.draftKind, undefined)
    assert.equal((await read(await f.reserve(b))).grant.attemptId, grant.attemptId)
    const rows = await f.db.run(c => Promise.all([c.db.query("publishingPosts").collect(), c.db.query("publishingAttempts").collect(), c.db.query("eventDeliveries").collect()]))
    assert.equal(rows[0].length, 2); assert.equal(rows[1].length, 2); assert.equal(rows[2][0]!.attemptId, grant.attemptId)
    const consumer = rows[0][1]!.consumer
    assert(consumer?.type === "event")
    assert.equal(consumer.deliveryId, d.deliveryId)
    await status(await f.http("/publishing/manage", { ...f.source(), actor: owner, operation: { type: "forget", postNo: grant.postNo, expectedGeneration: 1 } }), 409)
    assert((await read(await f.dispatch(grant))).claimed); await read(await f.outcome(grant, "uncertain"))
    assert.equal((await read(await f.reserve(b))).status, "terminal")
    assert.equal((await read(await f.delivery({ type: "status", eventNo: 1 }))).deliveries[0].state, "uncertain")
    await f.change({ type: "cancel" }); await status(await f.manage({ type: "forget", eventNo: 1, expectedRevision: (await f.event()).revision, confirm: "forget" }), 409)
})

test("Claim/cancel and revision races preserve actual outcomes while fencing all unclaimed sends", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); const published = await f.publish(1, false)
    assert((await read(await f.dispatch(published.grant))).claimed)
    await f.change({ type: "cancel" }); assert((await read(await f.outcome(published.grant))).recorded)
    const post = await read(await f.http("/publishing/query", { serverId: "1", actor: owner, operation: { type: "post-show", postNo: published.grant.postNo } })); assert.equal(post.post.outcome, "sent")
    await f.create("second"); const unclaimed = await f.publish(2, false); await f.change({ type: "cancel" }, 2)
    await status(await f.dispatch(unclaimed.grant), 409)
    assert.equal((await f.db.run(c => c.db.query("publishingAttempts").collect())).find(a => a._id === unclaimed.grant.attemptId)!.noDispatch, true)
})

test("Module and DEFCON pause participation and automatic work, resume skips overdue reminders and critical cancellation remains available", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create("gather", f.now() + 2 * 3600000); await f.publish()
    await read(await f.manage({ type: "settings", expectedRevision: 2, enabled: false })); await status(await f.http("/events/rsvp", await f.rsvpRequest("going")), 403)
    f.advance(65 * 60000); assert.deepEqual(await f.due(), [])
    await read(await f.manage({ type: "settings", expectedRevision: 3, enabled: true }))
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2 } } }))
    await status(await f.http("/events/rsvp", await f.rsvpRequest("going")), 403)
    await status(await f.query({ type: "show", eventNo: 1 }, f.context("20")), 403)
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
    await read(await f.query({ type: "status" })); await f.change({ type: "cancel" })
    await read(await f.manage({ type: "settings", expectedRevision: 4, enabled: false }))
})

test("Retention removes participation after thirty days, retains ownership anchors and explicit forgetting releases publishing and event quotas", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish(); await f.rsvp("going"); await f.change({ type: "cancel" })
    f.advance(30 * EVENTS_DAY); await f.cleanup()
    assert.equal((await f.db.run(c => c.db.query("eventRsvps").collect())).length, 0)
    assert.equal((await read(await f.query({ type: "status" }))).rsvps, 0)
    f.advance(150 * EVENTS_DAY); await f.cleanup(); assert.equal((await f.event()).eventNo, 1)
    let result = await f.change({ type: "forget", confirm: "forget" })
    for (let i = 0; !result.complete && i < 10; i++) result = await f.change({ type: "forget", confirm: "forget" })
    assert(result.complete)
    const counters = await f.db.run(c => Promise.all([c.db.query("eventSettings").unique(), c.db.query("publishingSettings").unique(), c.db.query("publishingPosts").collect()]))
    assert.equal(counters[0]!.definitions, 0); assert.equal(counters[0]!.occurrences, 0); assert.equal(counters[2].length, 0)
})

test("Indexed member-targets discovers seated accounts without promotion work, paginates and fences a newer rejoin or intent", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create()
    await f.change({ type: "calendar", calendar: f.calendar(f.now() + 2 * 3600000, 26) }); await f.publish()
    const first = await read(await f.query({ type: "dates", eventNo: 1 })), second = await read(await f.query({ type: "dates", eventNo: 1, afterOccurrenceNo: first.nextAfterOccurrenceNo })), third = await read(await f.query({ type: "dates", eventNo: 1, afterOccurrenceNo: second.nextAfterOccurrenceNo }))
    const dates = [...first.dates, ...second.dates, ...third.dates]
    for (const occurrence of dates.slice(0, 21)) await read(await f.http("/events/rsvp", { ...f.source(), context: f.context("20"), eventNo: 1, occurrenceNo: occurrence.occurrenceNo, choice: "going" }))
    assert.deepEqual(await f.jobs(), [])
    const page = await read(await f.work({ type: "member-targets", userId: "20" })); assert.equal(page.targets.length, 20); assert(page.nextCursor)
    const tail = await read(await f.work({ type: "member-targets", userId: "20", cursor: page.nextCursor })); assert.equal(tail.targets.length, 1); assert.equal(tail.nextCursor, undefined)
    const target = page.targets[0]
    const replacement = await f.rsvp("going", "20", 1, new Date(f.now()).toISOString())
    const oldObserve = { type: "observe", ...target, observedAt: f.now(), memberAbsent: true }
    assert.equal((await read(await f.work(oldObserve))).recorded, false)
    assert.equal((await f.dates())[0].going, 1)
    const current = (await read(await f.work({ type: "member-targets", userId: "20" }))).targets[0]
    await status(await f.work({ ...oldObserve, memberAbsent: false }), 400)
    assert.equal((await read(await f.work({ type: "observe", ...current, observedAt: f.now(), memberAbsent: true }))).recorded, true)
    assert.equal((await f.dates())[0].going, 0)
    assert.equal(replacement.rsvp.membershipGeneration, 2)
})

test("Automated promotion and reminders act as server automation without an administrator", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    await f.rsvp("going", "20"); await f.rsvp("going", "21"); await f.rsvp("none", "20")
    const job = (await f.jobs())[0]; assert.equal(job.channelId, "30")
    const h = await f.head()
    assert.equal((await read(await f.promote(h.binding, f.context("21")))).promoted, true)
    f.advance(3660000)
    const due = (await f.due())[0]; assert.equal(due.channelId, "30")
    await status(await f.reserve(f.deliveryBinding(due), f.context()), 400)
    await status(await f.reserve(f.deliveryBinding(due), { ...f.automation(), botAuthorized: false }), 403)
    const reserved = await read(await f.reserve(f.deliveryBinding(due))); assert.equal(reserved.status, "reserved"); assert.equal(reserved.grant.actorId, "999")
    await status(await f.dispatch(reserved.grant, f.context()), 400)
    await status(await f.dispatch(reserved.grant, f.automation("31")), 403)
    assert((await read(await f.dispatch(reserved.grant))).claimed)
})

test("Public configuration and participation reject exact finite bounds and preserve counters after quota failures", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    for (const operation of [{ type: "capacity", capacity: 0 }, { type: "capacity", capacity: 501 }, { type: "reminders", offsets: [1, 1] }, { type: "reminders", offsets: [0] }, { type: "reminders", offsets: [1, 2, 3] }]) await status(await f.manage({ ...operation, eventNo: 1, expectedRevision: (await f.event()).revision } as EventsManageOperation), 400)
    const setCount = async (field: "definitions" | "occurrences" | "rsvps", count: number) => f.db.run(async ctx => { const row = await ctx.db.query("eventSettings").unique(); await ctx.db.patch(row!._id, { [field]: count }) })
    await setCount("definitions", 50); await status(await f.manage({ type: "create", name: "overflow", title: "Overflow", channelId: "30" }), 429); await setCount("definitions", 1)
    await setCount("rsvps", 50000); await status(await f.http("/events/rsvp", await f.rsvpRequest("going")), 429); await setCount("rsvps", 0)
    assert.equal((await f.db.run(c => c.db.query("eventRsvps").collect())).length, 0)
    await f.db.run(async c => { const row = await c.db.query("eventOccurrences").unique(); await c.db.patch(row!._id, { rsvps: 1000 }) })
    await status(await f.http("/events/rsvp", await f.rsvpRequest("going")), 429)
    assert.equal((await f.db.run(c => c.db.query("eventRsvps").collect())).length, 0)
    await f.create("second")
    await setCount("occurrences", 200)
    await status(await f.manage({ type: "calendar", eventNo: 2, expectedRevision: (await f.event(2)).revision, calendar: f.calendar(f.now() + 3 * 3600000, 2) }), 429)
})

test("Elapsed reminder windows, reserve/claim revision races and restart aging preserve one attempt without replay", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create("gather", f.now() + 2 * 3600000); await f.publish()
    f.advance(3600000 + 240000)
    const d = (await f.due())[0], binding = f.deliveryBinding(d), grant = (await read(await f.reserve(binding))).grant
    assert.equal(grant.dispatchExpiresAt, d.dueAt + 300000)
    f.advance(60000)
    await status(await f.dispatch(grant), 409)
    await f.db.mutation(makeFunctionReference<"mutation">("publishing:observe"), { request: { serverId: "1", mode: "restart" } })
    assert.equal((await read(await f.reserve(binding))).status, "skipped")
    f.advance(140000); await f.db.mutation(makeFunctionReference<"mutation">("publishing:observe"), { request: { serverId: "1", mode: "restart" } })
    const attempt = (await f.db.run(c => c.db.query("publishingAttempts").collect())).find(a => a._id === grant.attemptId)!
    assert.equal(attempt.outcome, "failed"); assert(attempt.noDispatch)
    assert.equal((await f.db.run(c => c.db.query("publishingAttempts").collect())).length, 2)
})

test("Startup discovery resumes only unclaimed timer reservations and the dispatch claim stays one-time", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create("gather", f.now() + 120000); await f.change({ type: "reminders", offsets: [1] }); await f.publish()
    f.advance(60000)
    const initial = (await f.due())[0], binding = f.deliveryBinding(initial)
    const reservations = await Promise.all([f.reserve(binding), f.reserve(binding)].map(r => r.then(read)))
    assert.equal(reservations[0].grant.attemptId, reservations[1].grant.attemptId)
    const recovered = (await f.due())[0]; assert.equal(recovered.state, "reserved"); assert.equal(recovered.attemptId, reservations[0].grant.attemptId)
    const grant = (await read(await f.reserve(f.deliveryBinding(recovered)))).grant
    assert((await read(await f.dispatch(grant))).claimed); assert.equal((await read(await f.dispatch(grant))).claimed, false)
    assert.deepEqual(await f.due(), [])
    f.advance(70000)
    await f.db.mutation(makeFunctionReference<"mutation">("publishing:observe"), { request: { serverId: "1", mode: "restart" } })
    const attempt = (await f.db.run(c => c.db.query("publishingAttempts").collect())).find(a => a._id === grant.attemptId)!
    assert.equal(attempt.outcome, "uncertain")
    assert.equal((await read(await f.reserve(binding))).status, "terminal")
    assert.equal((await f.db.run(c => c.db.query("publishingAttempts").collect())).length, 2)
})

test("Guarded calendar replacement invalidates an unclaimed card and reuses its protected post without native replay", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); const original = await f.publish(1, false)
    const before = await f.dates(), changed = await f.change({ type: "calendar", calendar: f.calendar(f.now() + 3 * 3600000) })
    assert.equal(changed.grant.postNo, original.grant.postNo); assert.equal(changed.grant.generation, original.grant.generation + 1); assert.equal(changed.grant.action, "send")
    assert.notEqual((await f.dates())[0].occurrenceNo, before[0].occurrenceNo)
    await status(await f.dispatch(original.grant), 409); await f.apply(changed.grant)
    const attempts = await f.db.run(c => c.db.query("publishingAttempts").collect())
    assert.equal(attempts[0]!.outcome, "failed"); assert.equal(attempts[0]!.noDispatch, true); assert.equal(attempts[1]!.outcome, "sent")
    assert.equal((await f.db.run(c => c.db.query("publishingPosts").collect())).length, 1)
    const refreshed = await f.change({ type: "calendar", calendar: f.calendar(f.now() + 4 * 3600000) })
    assert.equal(refreshed.grant.action, "edit"); assert.equal(refreshed.grant.postNo, original.grant.postNo); assert(refreshed.grant.expectedContent)
})

test("Promotion sweeps advance beyond twenty known ineligible waiters across minute-long passes and preserve FIFO", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    await f.rsvp("going", "20")
    for (let userId = 21; userId <= 43; userId++) await f.rsvp("going", String(userId))
    await f.rsvp("none", "20")
    const originalOrder = (await f.own("21")).queueOrder
    for (let index = 0; index < 22; index++) {
        const h = await f.head(); assert.equal(h.binding.userId, String(21 + index))
        if (index === 10) {
            await read(await f.work({ type: "defer", binding: h.binding }))
            f.advance(60000)
            await status(await f.promote(h.binding), 409)
            const retry = await f.head(); assert.equal(retry.binding.userId, h.binding.userId)
            h.binding = retry.binding
        }
        const current = { ...f.context(), member: f.context(h.binding.userId).member! }; current.member.canView = false
        assert.equal((await read(await f.promote(h.binding, current))).promoted, false)
        f.advance(60000)
    }
    const head = await f.head(); assert.equal(head.binding.userId, "43"); assert.equal((await read(await f.promote(head.binding))).promoted, true)
    assert.equal((await f.own("21")).queueOrder, originalOrder)
    assert.equal((await f.dates())[0].going, 1)
    f.advance(60000); await f.rsvp("none", "43")
    assert.equal((await f.head()).binding.userId, "21")
})

test("Work discovery continues through bounded inactive and non-due rows across more than twenty occurrences", async t => {
    const f = fixture(t); await read(await f.enable())
    for (let index = 1; index <= 23; index++) {
        const eventNo = await f.create(`discovery-${index}`)
        if (index === 1) await f.change({ type: "calendar", calendar: f.calendar(f.now() + 2 * 3600000, 2) }, eventNo)
        await f.publish(eventNo)
        await f.rsvp("going", "20", eventNo); await f.rsvp("going", "21", eventNo); await f.rsvp("none", "20", eventNo)
    }
    const blocked = await f.head(1)
    await read(await f.work({ type: "defer", binding: blocked.binding }))
    const emptyPage = await read(await f.work({ type: "list", limit: 1 }))
    assert.deepEqual(emptyPage.jobs, [])
    assert.equal(emptyPage.nextCursor.eventNo, 1)
    const inactivePage = await read(await f.work({ type: "list", cursor: emptyPage.nextCursor, limit: 1 }))
    assert.deepEqual(inactivePage.jobs, [])
    assert.equal(inactivePage.nextCursor.eventNo, 1)
    assert(inactivePage.nextCursor.occurrenceNo > emptyPage.nextCursor.occurrenceNo)
    const jobs: number[] = []
    let cursor = inactivePage.nextCursor
    for (let page = 0; page < 8; page++) {
        const result = await read(await f.work({ type: "list", cursor, limit: 3 }))
        assert(result.jobs.length <= 3)
        jobs.push(...result.jobs.map((job: any) => job.eventNo))
        if (!result.nextCursor) { cursor = undefined; break }
        assert(result.nextCursor.eventNo > cursor.eventNo || result.nextCursor.eventNo === cursor.eventNo && result.nextCursor.occurrenceNo > cursor.occurrenceNo)
        cursor = result.nextCursor
    }
    assert.equal(cursor, undefined)
    assert.deepEqual(jobs, Array.from({ length: 22 }, (_, index) => index + 2))
    for (const operation of [{ type: "list", limit: 0 }, { type: "list", limit: 21 }, { type: "list", limit: 1.5 },
        { type: "list", cursor: { eventNo: 0, occurrenceNo: 1 } }, { type: "list", cursor: { eventNo: 1, occurrenceNo: 0 } },
        { type: "list", cursor: { eventNo: 1, occurrenceNo: 1, extra: true } }]) await status(await f.work(operation), 400)
})

test("Fresh timeout, verification and backend quarantine fences deny participation without consuming seats or work", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); await f.publish()
    const request = await f.rsvpRequest("going"), timedOut = f.context("20"); timedOut.member!.timeoutUntil = new Date(f.now() + 60000).toISOString()
    await status(await f.http("/events/rsvp", { ...request, context: timedOut }), 403)
    await status(await f.http("/events/rsvp", { ...request, context: { ...f.context("20"), observedAt: f.now() - 60001 } }), 400)
    await status(await f.http("/events/rsvp", { ...request, context: f.context("21") }), 200)
    // Existing moderation's durable quarantine is independently enforced by event admission
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic quarantine" }, context: { botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, botId: "999", currentTimeoutUntil: null } } }))
    await status(await f.http("/events/rsvp", await f.rsvpRequest("going", "20")), 403)
    assert.equal((await f.dates())[0].going, 1)
    await f.db.run(async ctx => {
        await ctx.db.insert("rolePanels", { serverId: "1", name: "verify", kind: "verification", enabled: false, revision: 1, exclusive: false, mappings: [{ emoji: "ok", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }], withdrawing: false })
    })
    await status(await f.http("/events/rsvp", await f.rsvpRequest("going", "22")), 403)
})

test("History expiry drains occurrence quotas but retains minimal unknown publication ownership and a discoverable recovery path", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create(); const published = await f.publish(1, false)
    assert((await read(await f.dispatch(published.grant))).claimed); await read(await f.outcome(published.grant, "uncertain")); await f.change({ type: "cancel" })
    f.advance(180 * EVENTS_DAY)
    await f.cleanup()
    assert.equal((await read(await f.query({ type: "status" }))).occurrences, 0)
    await f.cleanup()
    assert.equal((await f.db.run(c => c.db.query("eventDeliveries").collect())).length, 0)
    await f.cleanup()
    const record = await f.event()
    assert.equal(record.eventNo, 1); assert.equal(record.calendar, undefined); assert.equal(record.description, "")
    assert.equal((await read(await f.query({ type: "status" }))).occurrences, 0)
    await status(await f.manage({ type: "forget", eventNo: 1, expectedRevision: record.revision, confirm: "forget" }), 409)
    const post = await read(await f.http("/publishing/query", { serverId: "1", actor: owner, operation: { type: "post-show", postNo: published.grant.postNo } }))
    assert.equal(post.post.attempt.outcome, "uncertain"); assert.equal(post.post.consumer.eventNo, record.eventNo)
})

test("A second Administrator publishes and edits with their own human evidence and reminders act as the bot", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create()
    const admin = () => { const current = f.context("40"); current.actor.isAdministrator = true; return current }
    const publish = await read(await f.manage({ type: "publish", eventNo: 1, expectedRevision: (await f.event()).revision }, admin()))
    assert.equal(publish.grant.actorId, "40"); assert.equal(publish.grant.source.type, "human")
    await status(await f.dispatch(publish.grant), 403); assert((await read(await f.dispatch(publish.grant, admin()))).claimed); await read(await f.outcome(publish.grant))
    const edited = await read(await f.manage({ type: "content", eventNo: 1, expectedRevision: (await f.event()).revision, title: "Updated gathering", description: "Updated details" }, admin()))
    assert.equal(edited.grant.actorId, "40"); assert.equal(edited.grant.action, "edit")
    assert((await read(await f.dispatch(edited.grant, admin()))).claimed)
    await read(await f.http("/publishing/outcome", { serverId: "1", postNo: edited.grant.postNo, attemptId: edited.grant.attemptId, generation: edited.grant.generation, sourceId: edited.grant.sourceId, claimToken: "a".repeat(32), outcome: "sent", messageId: edited.grant.messageId }))
    const after = await f.change({ type: "content", title: "Human-managed card", description: "" })
    assert.equal(after.grant.actorId, "10")
    assert((await read(await f.dispatch(after.grant))).claimed)
    await read(await f.http("/publishing/outcome", { serverId: "1", postNo: after.grant.postNo, attemptId: after.grant.attemptId, generation: after.grant.generation, sourceId: after.grant.sourceId, claimToken: "a".repeat(32), outcome: "sent", messageId: after.grant.messageId }))
    f.advance(3600000)
    const due = (await f.due())[0]
    f.advance(60000)
    const reminder = await read(await f.reserve(f.deliveryBinding(due)))
    assert.equal(reminder.status, "reserved"); assert.equal(reminder.grant.actorId, "999")
    await status(await f.dispatch(reminder.grant, admin()), 400); assert((await read(await f.dispatch(reminder.grant))).claimed)
})

test("Settled forgetting drains more than one publishing page with exact quota accounting and no stranded protection", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create()
    const calendar = f.calendar(f.now() + 2 * 3600000, 26)
    await f.change({ type: "calendar", calendar }); await f.change({ type: "reminders", offsets: [1] }); await f.publish()
    for (const date of calendar.dates) {
        f.advance(date.startsAt - 60000 - f.now())
        const due = (await f.due())[0], grant = (await read(await f.reserve(f.deliveryBinding(due)))).grant
        await f.apply(grant)
    }
    await f.change({ type: "cancel" })
    const first = await f.change({ type: "forget", confirm: "forget" }); assert.equal(first.complete, false); assert.equal(first.removed, 20)
    assert.equal((await f.db.run(c => c.db.query("publishingPosts").collect())).length, 7)
    let result = first
    for (let page = 0; page < 6 && !result.complete; page++) {
        result = await f.change({ type: "forget", confirm: "forget" })
        assert(result.removed <= 21)
        const counted = await f.db.run(c => Promise.all([c.db.query("publishingSettings").unique(), c.db.query("publishingPosts").collect(), c.db.query("eventSettings").unique(), c.db.query("eventOccurrences").collect()]))
        assert.equal(counted[2]!.occurrences, counted[3].length)
    }
    assert(result.complete)
    const counted = await f.db.run(c => Promise.all([c.db.query("eventSettings").unique(), c.db.query("publishingSettings").unique(), c.db.query("eventDeliveries").collect(), c.db.query("events").collect()]))
    assert.equal(counted[0]!.definitions, 0); assert.equal(counted[0]!.occurrences, 0); assert.equal(counted[2].length, 0); assert.equal(counted[3].length, 0)
})

test("Event templates copy an exact revision and final rendered metadata remains subject to publishing limits", async t => {
    const f = fixture(t); await read(await f.enable()); await f.create()
    const publishing = (operation: unknown) => f.http("/publishing/manage", { ...f.source(), actor: owner, operation })
    await read(await publishing({ type: "draft-create", kind: "template", name: "card" }))
    await read(await publishing({ type: "draft-update", kind: "template", name: "card", expectedRevision: 1, edit: { type: "content", content: "Copied authored content" } }))
    const copied = await f.change({ type: "template", templateName: "card", expectedTemplateRevision: 2 }); assert.equal(copied.event.template.revision, 2)
    await read(await publishing({ type: "draft-update", kind: "template", name: "card", expectedRevision: 2, edit: { type: "content", content: "Later template content" } }))
    const published = await f.publish(); assert.equal(published.grant.content.content, "Copied authored content"); assert.equal(published.grant.provenance.template.revision, 2)
    const fields = Array.from({ length: 23 }, (_, i) => ({ name: String(i + 1), value: "Synthetic field" }))
    await read(await publishing({ type: "draft-update", kind: "template", name: "card", expectedRevision: 3, edit: { type: "embed", embed: { fields } } }))
    const before = await f.event()
    await status(await f.manage({ type: "template", eventNo: 1, expectedRevision: before.revision, templateName: "card", expectedTemplateRevision: 4 }), 400)
    assert.deepEqual(await f.event(), before)
})
