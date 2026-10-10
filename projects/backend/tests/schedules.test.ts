import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { SchedulesCalendar, SchedulesContext, SchedulesDelivery, SchedulesDeliveryGrant } from "../contracts.js"
import schema from "../convex/schema.ts"
import { validateScheduleCalendar } from "../convex/schedulesDomain.ts"
import { civilDayEnded, resolveCivilInstant } from "../convex/civilDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-schedules-secret-not-a-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/schedules.ts": () => import("../convex/schedules.ts"), "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"), "../convex/schedulesCleanup.ts": () => import("../convex/schedulesCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (): SchedulesContext => ({ observedAt: now, actor: owner, channelId: "30", botId: "999", botAuthorized: true, actorAuthorized: true, member: { userId: "10", joinedAt: "2025-12-01T00:00:00.000001Z", roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manage = (operation: unknown, current = context()) => http("/schedules/manage", { ...source(), context: current, operation })
    const query = (operation: unknown) => http("/schedules/query", { serverId: "1", context: context(), operation })
    const publish = (operation: unknown) => http("/publishing/manage", { ...source(), actor: owner, operation })
    await read(await publish({ type: "draft-create", kind: "draft", name: "announcement" }))
    await read(await publish({ type: "draft-update", kind: "draft", name: "announcement", expectedRevision: 1, edit: { type: "content", content: "Synthetic announcement" } }))
    const snapshot = { kind: "draft", name: "announcement", revision: 2 }
    const calendar = (count = 1, dueAt = now + 120000): SchedulesCalendar => ({ localMinute: new Date(dueAt).toISOString().slice(0, 16), zone: "UTC", fold: "reject", recurrence: count === 1 ? { type: "none" } : { type: "daily", interval: 1, count }, dates: Array.from({ length: count }, (_, i) => ({ localMinute: new Date(dueAt + i * 86400000).toISOString().slice(0, 16), dueAt: dueAt + i * 86400000, offsetMinutes: 0 })) })
    const create = (name = "notice", count = 1) => manage({ type: "create", name, source: snapshot, channelId: "30", calendar: calendar(count) }).then(read).then(value => value.schedule)
    const show = (scheduleNo = 1) => query({ type: "show", scheduleNo }).then(read).then(value => value.schedule)
    const deliveries = (scheduleNo = 1, afterOccurrenceNo?: number): Promise<{ deliveries: SchedulesDelivery[], nextAfterOccurrenceNo?: number }> => query({ type: "deliveries", scheduleNo, ...(afterOccurrenceNo === undefined ? {} : { afterOccurrenceNo }) }).then(read)
    const totals = () => query({ type: "status" }).then(read)
    const change = async (operation: Record<string, unknown>, scheduleNo = 1) => read(await manage({ ...operation, scheduleNo, expectedRevision: (await show(scheduleNo)).revision }))
    const open = async (count = 1) => { await read(await manage({ type: "settings", expectedRevision: 1, enabled: true })); await create("notice", count); return change({ type: "enable" }) }
    const binding = (row: SchedulesDelivery) => ({ deliveryId: row.deliveryId, scheduleNo: row.scheduleNo, planRevision: row.planRevision, occurrenceNo: row.occurrenceNo })
    const delivery = (operation: unknown) => http("/schedules/delivery", { serverId: "1", operation })
    const automation = () => ({ observedAt: now, channelId: "30", botId: "999", botAuthorized: true })
    const reserve = (row: SchedulesDelivery, current: unknown = automation()) => delivery({ type: "reserve", binding: binding(row), context: current })
    const dispatch = (grant: SchedulesDeliveryGrant, current: unknown = automation(), claimToken = "a".repeat(32)) => http("/publishing/dispatch", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken, scheduleContext: current })
    const outcome = (grant: SchedulesDeliveryGrant, value = "sent", messageId = "8000") => http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), outcome: value, ...(value === "sent" ? { messageId } : {}) })
    const cleanup = () => db.mutation(makeFunctionReference<"mutation">("schedulesCleanup:cleanup"), {})
    return { db, source, context, automation, http, manage, query, publish, snapshot, calendar, create, show, deliveries, totals, change, open, binding, delivery, reserve, dispatch, outcome, cleanup, advance: (ms: number) => { now += ms }, now: () => now }
}

test("Schedule indexes have no duplicate field sets within changed tables", () => {
    for (const name of ["scheduleSettings", "schedules", "scheduleDeliveries", "scheduleReceipts", "publishingSettings", "publishingPosts", "publishingAttempts"] as const) {
        const indexes = schema.tables[name][" indexes"](), fields = indexes.map(index => JSON.stringify(index.fields))
        assert.equal(new Set(fields).size, fields.length, name)
    }
})

test("Schedule civil validation enforces finite bounds and preserves explicit folds and elapsed-free instants", async t => {
    const f = await fixture(t)
    assert.equal(validateScheduleCalendar(f.calendar(26)).dates.length, 26)
    const base = f.calendar()
    for (const changed of [
        { ...base, dates: [] }, { ...base, durationMinutes: 1 }, { ...base, fold: "automatic" },
        { ...base, recurrence: { type: "daily", count: 27, interval: 1 } },
        { ...base, recurrence: { type: "daily", count: 1, interval: 0 } },
        { ...base, recurrence: { type: "weekly", count: 1, interval: 13 } },
        { ...base, recurrence: { type: "forever" } },
        { ...base, dates: [{ ...base.dates[0], localMinute: "2026-02-30T00:00" }] },
        { ...base, dates: [{ ...base.dates[0], dueAt: base.dates[0]!.dueAt + 1 }] },
    ]) assert.throws(() => validateScheduleCalendar(changed))
    assert.throws(() => validateScheduleCalendar(f.calendar(1, f.now())))
    assert.throws(() => validateScheduleCalendar(f.calendar(1, f.now() + 181 * 86400000)))
    assert.throws(() => resolveCivilInstant("2026-03-29T02:30", "Europe/Berlin", "reject"))
    assert.throws(() => resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "reject"))
    assert.deepEqual(resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "earlier"), { instantAt: Date.parse("2026-10-25T00:30Z"), offsetMinutes: 120 })
    assert.deepEqual(resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "later"), { instantAt: Date.parse("2026-10-25T01:30Z"), offsetMinutes: 60 })
    assert.deepEqual(resolveCivilInstant("2026-04-01T12:00", "Asia/Kathmandu", "reject"), { instantAt: Date.parse("2026-04-01T06:15Z"), offsetMinutes: 345 })
})

test("Non-calendar schedule edits copy frozen dates after time advances and timezone data changes", async t => {
    const f = await fixture(t); await f.open(3)
    const original = await f.show(), before = (await f.deliveries()).deliveries
    f.advance(180000)
    t.mock.method(Intl, "DateTimeFormat", () => { throw new Error("Synthetic changed timezone database") })
    const edited = (await f.change({ type: "content", source: f.snapshot })).schedule
    assert.deepEqual(edited.calendar, original.calendar)
    assert.equal(edited.planRevision, original.planRevision + 1)
    const rows = (await f.deliveries()).deliveries
    assert.deepEqual(rows.find(row => row.deliveryId === before[0]!.deliveryId), before[0])
    assert.deepEqual(rows.filter(row => row.planRevision === edited.planRevision).map(row => row.dueAt), original.calendar.dates.slice(1).map((date: any) => date.dueAt))
    await f.change({ type: "destination", channelId: "30" })
    assert.deepEqual((await f.show()).calendar, original.calendar)
})

test("Definition and retained delivery caps include superseded anchors and roll back failed replacements", async t => {
    const f = await fixture(t)
    for (let i = 0; i < 7; i++) await f.create(`batch-${i}`, 26)
    await f.create("remaining", 18)
    const before = await f.totals(), original = await f.show(), rows = await f.deliveries()
    assert.equal(before.deliveries, 200)
    await status(await f.manage({ type: "create", name: "overflow", source: f.snapshot, channelId: "30", calendar: f.calendar() }), 429)
    await status(await f.manage({ type: "content", scheduleNo: 1, expectedRevision: original.revision, source: f.snapshot }), 429)
    assert.deepEqual(await f.totals(), before)
    assert.deepEqual(await f.show(), original)
    assert.deepEqual(await f.deliveries(), rows)
    await f.change({ type: "cancel" })
    const first = (await f.deliveries()).deliveries
    await f.change({ type: "forget", confirm: "forget", occurrenceNos: first.slice(0, 2).map(row => row.occurrenceNo) })
    assert.equal((await f.totals()).deliveries, 198)
    await f.create("released", 2)
    assert.equal((await f.totals()).deliveries, 200)
})

test("Fifty schedule definitions remain independently bounded and paginated at twenty", async t => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.create(`notice-${i}`)
    const before = await f.totals()
    await status(await f.manage({ type: "create", name: "notice-51", source: f.snapshot, channelId: "30", calendar: f.calendar() }), 429)
    assert.deepEqual(await f.totals(), before)
    let cursor: number | undefined
    const numbers: number[] = []
    for (let page = 0; page < 3; page++) {
        const result = await read(await f.query({ type: "list", ...(cursor === undefined ? {} : { beforeScheduleNo: cursor }) }))
        assert(result.schedules.length <= 20)
        numbers.push(...result.schedules.map((row: any) => row.scheduleNo)); cursor = result.nextBeforeScheduleNo
    }
    assert.equal(cursor, undefined); assert.equal(new Set(numbers).size, 50)
})

test("Schedule show finds a schedule by its unique name", async t => {
    const f = await fixture(t), row = await f.create("notice")
    assert.deepEqual((await read(await f.query({ type: "show", name: "Notice" }))).schedule, row)
    await status(await f.query({ type: "show", name: "missing" }), 404)
    for (const operation of [{ type: "show", name: "notice", scheduleNo: row.scheduleNo }, { type: "show", name: "not a name" }]) await status(await f.query(operation), 400)
    await status(await f.manage({ type: "create", name: "notice", source: f.snapshot, channelId: "30", calendar: f.calendar() }), 409)
})

test("Schedule receipt quota, source freshness and bounded expiry release exact counters", async t => {
    const f = await fixture(t); await f.create()
    await f.db.run(async ctx => {
        const state = (await ctx.db.query("scheduleSettings").collect())[0]!
        for (let i = 0; i < 999; i++) await ctx.db.insert("scheduleReceipts", { serverId: "1", messageId: String(200000 + i), actorId: "10", operationKey: "synthetic", createdAt: f.now() - 86400000, expiresAt: f.now() })
        await ctx.db.patch(state._id, { receipts: 1000 })
    })
    const before = await f.totals()
    await status(await f.manage({ type: "disable", scheduleNo: 1, expectedRevision: 1 }), 429)
    assert.deepEqual(await f.totals(), before)
    await status(await f.http("/schedules/manage", { ...f.source(), createdAt: f.now() - 900001, context: f.context(), operation: { type: "disable", scheduleNo: 1, expectedRevision: 1 } }), 400)
    await status(await f.http("/schedules/manage", { ...f.source(), createdAt: f.now() + 60001, context: f.context(), operation: { type: "disable", scheduleNo: 1, expectedRevision: 1 } }), 400)
    assert.equal((await f.cleanup()).removed, 20)
    assert.equal((await f.totals()).receipts, 980)
    assert.equal((await f.db.run(ctx => ctx.db.query("scheduleReceipts").collect())).length, 980)
    await f.change({ type: "disable" })
    assert.equal((await f.totals()).receipts, 981)
})

test("Automatic schedule reservation and claim require the bot's fresh destination rights", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!, valid = f.automation()
    const denied = [{ ...valid, botAuthorized: false }, { ...valid, channelId: "31" }]
    await status(await f.reserve(row, denied[0]), 403)
    assert.deepEqual(await read(await f.reserve(row, denied[1])), { type: "reservation", status: "waiting" })
    const grant = (await read(await f.reserve(row))).grant
    for (const context of denied) await status(await f.dispatch(grant, context), 403)
    await status(await f.dispatch(grant, { ...valid, observedAt: f.now() - 60001 }), 400)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    assert.deepEqual(await read(await f.outcome(grant)), { recorded: true })
})

test("DEFCON gates bot automation while critical management remains usable", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!
    await f.db.run(async ctx => { const moderation = await moderationState(ctx, "1"); await ctx.db.patch(moderation._id, { config: { ...moderation.config, defcon: 1 } }) })
    assert.deepEqual(await read(await f.reserve(row)), { type: "reservation", status: "waiting" })
    await f.change({ type: "disable" }); await f.change({ type: "cancel" })
    assert.equal((await f.show()).cancelled, true)
})

test("Concurrent recovery reserves one immutable attempt and only one dispatch claim", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!
    const grants = await Promise.all([f.reserve(row), f.reserve(row)].map(response => response.then(read)))
    assert.equal(grants[0].grant.attemptId, grants[1].grant.attemptId)
    const claims = await Promise.all([f.dispatch(grants[0].grant), f.dispatch(grants[1].grant, f.context(), "b".repeat(32))].map(response => response.then(read)))
    assert.equal(claims.filter(claim => claim.claimed).length, 1)
    assert.deepEqual((await read(await f.delivery({ type: "list" }))).deliveries, [])
})

test("Only genuine activations move cutoffs and due time equal to a cutoff never dispatches", async t => {
    const f = await fixture(t); await f.open(2)
    const original = await f.show(), settings = (await read(await f.query({ type: "settings" }))).settings
    const rows = (await f.deliveries()).deliveries
    f.advance(120000)
    const grant = (await read(await f.reserve(rows[0]!))).grant
    await f.change({ type: "enable" })
    await read(await f.manage({ type: "settings", expectedRevision: settings.revision, enabled: true }))
    await read(await f.publish({ type: "settings", patch: { enabled: true } }))
    assert.equal((await f.show()).activatedAt, original.activatedAt)
    assert.equal((await read(await f.query({ type: "settings" }))).settings.activatedAt, settings.activatedAt)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    await read(await f.outcome(grant))
    await f.change({ type: "disable" })
    f.advance(rows[1]!.dueAt - f.now())
    const resumed = (await f.change({ type: "enable" })).schedule
    assert.equal(resumed.activatedAt, rows[1]!.dueAt)
    assert.deepEqual(await read(await f.reserve(rows[1]!)), { type: "reservation", status: "skipped" })
    const skipped = (await f.deliveries()).deliveries[1]!
    assert.equal(skipped.reason, "activation-cutoff")
    assert.equal(skipped.attemptId, undefined)
})

test("Bounded settled forgetting releases exact quotas across pages and retains native metadata until retirement", async t => {
    const f = await fixture(t); await f.open(26)
    const rows = [...(await f.deliveries()).deliveries]
    rows.push(...(await f.deliveries(1, rows.at(-1)!.occurrenceNo)).deliveries)
    f.advance(120000)
    const grant = (await read(await f.reserve(rows[0]!))).grant
    await read(await f.dispatch(grant)); await read(await f.outcome(grant))
    await f.change({ type: "cancel" })
    const first = await f.change({ type: "forget", confirm: "forget" })
    assert.equal(first.removed, 20); assert.equal(first.complete, false)
    assert.equal((await f.totals()).deliveries, 6)
    const second = await f.change({ type: "forget", confirm: "forget" })
    assert.equal(second.removed, 6); assert.equal(second.complete, true)
    assert.equal((await f.totals()).deliveries, 0); assert.equal((await f.totals()).definitions, 0)
    assert.deepEqual(await f.db.run(async ctx => ({ deliveries: await ctx.db.query("scheduleDeliveries").collect(), posts: await ctx.db.query("publishingPosts").collect(), attempts: await ctx.db.query("publishingAttempts").collect() })), { deliveries: [], posts: [], attempts: [] })
})

test("Aged claims remain uncertain and history cleanup retains their ownership anchors", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!, grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant)); f.advance(190000)
    await read(await f.http("/publishing/observe", { serverId: "1", mode: "restart" }))
    assert.equal((await f.deliveries()).deliveries[0]!.state, "uncertain")
    await status(await f.manage({ type: "forget", scheduleNo: 1, expectedRevision: (await f.show()).revision, confirm: "forget", occurrenceNos: [row.occurrenceNo] }), 409)
    f.advance(181 * 86400000); await f.cleanup()
    assert.equal((await f.totals()).deliveries, 1)
    const retained = (await f.deliveries()).deliveries[0]!
    assert.equal(retained.attemptId, grant.attemptId); assert.equal(retained.state, "uncertain")
    assert.deepEqual(retained.content, { content: "" })
    const attempts = await f.db.run(ctx => ctx.db.query("publishingAttempts").collect())
    assert.equal(attempts[0]!.unresolved, true); assert.equal(attempts[0]!.messageId, undefined)
    assert.equal(attempts[0]!.content.content, "Synthetic announcement")
})
test("Late schedule occurrences still send on their local due day and skip once that day ends", async t => {
    const f = await fixture(t); await f.open(2)
    f.advance(120000 + 6 * 3600000)
    const late = (await read(await f.delivery({ type: "list" }))).deliveries
    assert.equal(late.length, 1)
    assert.equal((await read(await f.reserve(late[0]))).grant.dispatchExpiresAt, f.now() + 180000)
    f.advance(2 * 86400000)
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
    const second = (await f.deliveries()).deliveries[1]!
    assert.equal(second.state, "skipped"); assert.equal(second.reason, "late-window")
})
test("The late window ends at the next local midnight in the delivery's zone, across daylight-saving changes", () => {
    const dueAt = Date.parse("2026-01-01T20:00Z")
    assert.equal(civilDayEnded(dueAt, "Europe/Kaliningrad", Date.parse("2026-01-01T21:59Z")), false)
    assert.equal(civilDayEnded(dueAt, "Europe/Kaliningrad", Date.parse("2026-01-01T22:00Z")), true)
    assert.equal(civilDayEnded(dueAt, "America/Bogota", Date.parse("2026-01-02T04:59Z")), false)
    assert.equal(civilDayEnded(dueAt, "America/Bogota", Date.parse("2026-01-02T05:00Z")), true)
    // Berlin due March 29 00:30 CET closes at March 30 00:00 CEST, and due October 25 00:30 CEST closes at October 26 00:00 CET
    const spring = Date.parse("2026-03-28T23:30Z"), autumn = Date.parse("2026-10-24T22:30Z")
    assert.equal(resolveCivilInstant("2026-03-29T00:30", "Europe/Berlin", "reject").instantAt, spring)
    assert.equal(resolveCivilInstant("2026-10-25T00:30", "Europe/Berlin", "reject").instantAt, autumn)
    assert.equal(civilDayEnded(spring, "Europe/Berlin", Date.parse("2026-03-29T21:59Z")), false)
    assert.equal(civilDayEnded(spring, "Europe/Berlin", Date.parse("2026-03-29T22:00Z")), true)
    assert.equal(civilDayEnded(autumn, "Europe/Berlin", Date.parse("2026-10-25T22:59Z")), false)
    assert.equal(civilDayEnded(autumn, "Europe/Berlin", Date.parse("2026-10-25T23:00Z")), true)
})
