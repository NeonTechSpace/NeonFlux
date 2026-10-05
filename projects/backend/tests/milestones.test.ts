import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { MilestonesContext, MilestonesDelivery, MilestonesDeliveryGrant, MilestonesParticipantContext } from "../contracts.js"
import schema from "../convex/schema.ts"
import { milestoneAnnual, milestoneMonthDay, renderMilestone } from "../convex/milestonesDomain.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-milestones-secret-not-a-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/milestones.ts": () => import("../convex/milestones.ts"), "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"), "../convex/milestonesCleanup.ts": () => import("../convex/milestonesCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal(response.headers.get("cache-control"), "no-store"); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }), source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (): MilestonesContext => ({ observedAt: now, actor: owner, channelId: "30", botId: "999", botAuthorized: true, actorAuthorized: true, member: { userId: "10", joinedAt: "2024-01-01T00:00:00.000001Z", roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } })
    const participant = (userId = "20", joinedAt = "2024-01-01T00:00:00.000001Z"): MilestonesParticipantContext => ({ observedAt: now, channelId: "30", botId: "999", member: { userId, joinedAt, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }, userName: "Synthetic *member*", serverName: "Synthetic server" })
    const identity = (userId = "20") => ({ userId, channelId: "90", isDirectMessage: true, isBot: false, observedAt: now })
    const http = (path: string, body: unknown, auth = true) => db.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const manage = (operation: unknown, current = context()) => http("/milestones/manage", { ...source(), context: current, operation })
    const query = (operation: unknown) => http("/milestones/query", { serverId: "1", context: context(), operation })
    const personal = (operation: unknown, userId = "20") => http("/milestones/personal", { ...source(), identity: identity(userId), operation })
    const delivery = (operation: unknown) => http("/milestones/delivery", { serverId: "1", operation })
    const publish = (operation: unknown) => http("/publishing/manage", { ...source(), actor: owner, operation })
    await read(await publish({ type: "draft-create", kind: "template", name: "celebrate" }))
    await read(await publish({ type: "draft-update", kind: "template", name: "celebrate", expectedRevision: 1, edit: { type: "content", content: "Celebrating {user} at {server}" } }))
    const configure = (kind = "birthday", revision = 0, channelId = "30", zone = "UTC", time = "00:02", fold = "reject") => manage({ type: "configure", kind, expectedRevision: revision, channelId, zone, time, fold, template: { name: "celebrate", revision: 2 } }, { ...context(), channelId })
    const routes = () => query({ type: "settings" }).then(read).then(result => result.routes)
    const change = async (type: string, kind = "birthday", extra: object = {}) => manage({ type, kind, expectedRevision: (await routes()).find((r: any) => r.kind === kind).revision, ...extra })
    const enroll = (kind = "birthday", monthDay = "01-01", userId = "20", proof = participant(userId)) => personal({ type: "enroll", kind, ...(kind === "birthday" ? { monthDay } : {}), confirmChannelId: proof.channelId, participant: proof }, userId)
    const open = async () => { await read(await manage({ type: "settings", expectedRevision: 1, enabled: true })); await read(await configure()); await read(await change("enable")); await read(await enroll()) }
    const deliveries = (kind = "birthday") => query({ type: "deliveries", kind }).then(read).then(result => result.deliveries as MilestonesDelivery[])
    const binding = (row: MilestonesDelivery) => ({ deliveryId: row.deliveryId, kind: row.kind, intentRevision: row.intentRevision, userId: row.userId, joinedAt: row.joinedAt, consentRevision: row.consentRevision, audienceGeneration: row.audienceGeneration, celebrationYear: row.celebrationYear, completedYears: row.completedYears, generation: row.generation })
    const automation = (): unknown => ({ observedAt: now, channelId: "30", botId: "999", botAuthorized: true })
    const reserve = (row: MilestonesDelivery, proof = participant(row.userId, row.joinedAt), current = automation()) => delivery({ type: "reserve", binding: binding(row), context: { automation: current, participant: proof } })
    const dispatch = (grant: MilestonesDeliveryGrant, proof = participant(grant.consumer.userId, grant.consumer.joinedAt)) => http("/publishing/dispatch", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), milestoneContext: { automation: automation(), participant: proof } })
    const outcome = (grant: MilestonesDeliveryGrant, value = "sent") => http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), outcome: value, ...(value === "sent" ? { messageId: "8000" } : {}) })
    const cleanup = () => db.mutation(makeFunctionReference<"mutation">("milestonesCleanup:cleanup"), {})
    return { db, source, context, participant, identity, http, manage, query, personal, delivery, publish, configure, routes, change, enroll, open, deliveries, binding, reserve, dispatch, outcome, cleanup, advance: (ms: number) => { now += ms }, setNow: (value: number) => { now = value }, now: () => now }
}

test("Milestone indexes have no duplicate field sets", () => {
    for (const name of ["milestoneSettings", "milestoneRoutes", "milestoneMembers", "milestoneEnrollments", "milestoneDeliveries", "milestoneReceipts", "milestoneConsumed", "publishingPosts", "publishingAttempts"] as const) {
        const indexes = schema.tables[name][" indexes"]().map(index => JSON.stringify(index.fields))
        assert.equal(new Set(indexes).size, indexes.length, name)
    }
})
test("Annual civil rules cover leap fallback, raw membership timezone years and skipped gaps/folds", () => {
    for (const value of ["13-01", "00-00", "02-30", "04-31", "2020-01-01", "1-01", "01-1"]) assert.throws(() => milestoneMonthDay(value), error => (error as { data: { status: number } }).data?.status === 400)
    assert.equal(milestoneMonthDay("02-29"), "02-29")
    const utc = { zone: "UTC", time: "09:00", fold: "reject" as const }
    assert.equal(milestoneAnnual("birthday", "2020-01-01T00:00Z", "02-29", utc, 2027).instantAt, Date.parse("2027-02-28T09:00Z"))
    assert.equal(milestoneAnnual("anniversary", "2024-02-29T00:00Z", undefined, utc, 2027).instantAt, Date.parse("2027-02-28T09:00Z"))
    assert.equal(milestoneAnnual("anniversary", "2024-12-31T23:30:00.000001Z", undefined, { ...utc, zone: "Europe/Berlin" }, 2026).completedYears, 1)
    assert.equal(milestoneAnnual("birthday", "2020-01-01T00:00Z", "03-29", { zone: "Europe/Berlin", time: "02:30", fold: "reject" }, 2026).reason, "civil-gap")
    assert.equal(milestoneAnnual("birthday", "2020-01-01T00:00Z", "10-25", { zone: "Europe/Berlin", time: "02:30", fold: "reject" }, 2026).reason, "civil-fold")
    const earlier = milestoneAnnual("birthday", "2020-01-01T00:00Z", "10-25", { zone: "Europe/Berlin", time: "02:30", fold: "earlier" }, 2026), later = milestoneAnnual("birthday", "2020-01-01T00:00Z", "10-25", { zone: "Europe/Berlin", time: "02:30", fold: "later" }, 2026)
    assert.equal(later.instantAt - earlier.instantAt, 3600000)
    assert.throws(() => renderMilestone({ content: "{years}" }, "birthday", "Test", "Server", 0))
})
test("Authenticated private author, explicit destination and fresh participant evidence bound enrollment", async t => {
    const f = await fixture(t)
    await status(await f.http("/milestones/query", { serverId: "1", context: f.context(), operation: { type: "status" } }, false), 401)
    await read(await f.configure())
    for (const monthDay of ["13-01", "00-00", "02-30", "2020-01-01"]) await status(await f.enroll("birthday", monthDay), 400)
    const op = { type: "enroll", kind: "birthday", monthDay: "01-01", confirmChannelId: "30", participant: f.participant() }
    await status(await f.http("/milestones/personal", { ...f.source(), identity: { ...f.identity(), isDirectMessage: false }, operation: op }), 403)
    await status(await f.http("/milestones/personal", { ...f.source(), identity: f.identity("21"), operation: op }), 403)
    await status(await f.personal({ ...op, confirmChannelId: "31" }), 409)
    await read(await f.enroll())
    assert.equal((await read(await f.personal({ type: "me" }, "21"))).enrollments.length, 0)
    const receipts = await f.db.run(ctx => ctx.db.query("milestoneReceipts").collect())
    assert(!JSON.stringify(receipts).includes("01-01"))
    assert(receipts.filter(r => r.category === "member").every(r => /^[a-f0-9]{64}$/.test(r.operationKey)))
})
test("Actual source idempotency rejects changed private operation and stale enrollment after removal", async t => {
    const f = await fixture(t); await read(await f.configure())
    const src = f.source(), request = { ...src, identity: f.identity(), operation: { type: "enroll", kind: "birthday", monthDay: "01-01", confirmChannelId: "30", participant: f.participant() } }
    await read(await f.http("/milestones/personal", request))
    assert.deepEqual(await read(await f.http("/milestones/personal", request)), { duplicate: true })
    await status(await f.http("/milestones/personal", { ...request, operation: { ...request.operation, monthDay: "02-01" } }), 409)
    const delayed = { ...f.source(), identity: f.identity(), operation: request.operation }
    f.advance(1)
    await read(await f.personal({ type: "remove", kind: "all" }))
    await status(await f.http("/milestones/personal", delayed), 409)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
})
test("List to publisher atomically binds the bot and member, resumes exact attempt, suppresses raw birthday", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const listed = await read(await f.delivery({ type: "list" })), row = listed.deliveries[0] as MilestonesDelivery
    assert(row)
    assert.equal(row.userId, "20")
    const grant = (await read(await f.reserve(row))).grant as MilestonesDeliveryGrant
    assert.equal(grant.source.type, "milestone-timer"); assert.equal(grant.consumer.type, "milestone")
    assert.equal(grant.actorId, "999"); assert.equal(grant.content.content, "Birthday celebration\nCelebrating Synthetic \\*member\\* at Synthetic server")
    assert(!JSON.stringify(grant).includes('"monthDay"'))
    assert.equal((await read(await f.reserve(row))).grant.attemptId, grant.attemptId)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    await read(await f.outcome(grant))
    await status(await f.publish({ type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation }), 409)
    const state = await read(await f.query({ type: "status" }))
})
test("Destination changes require consent again even on return, and other administrators can edit the route", async t => {
    const f = await fixture(t); await f.open()
    let route = (await f.routes())[0]
    await read(await f.configure("birthday", route.revision, "31"))
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, true)
    route = (await f.routes())[0]; await read(await f.configure("birthday", route.revision, "30"))
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, true)
    await read(await f.enroll())
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments[0].needsReconsent, false)
    const admin = { ...f.context(), actor: { ...owner, userId: "11", isOwner: false, isAdministrator: true }, member: { ...f.context().member!, userId: "11" } }
    route = (await f.routes())[0]
    await read(await f.manage({ type: "configure", kind: "birthday", expectedRevision: route.revision, channelId: "30", zone: "UTC", time: "00:03", fold: "reject", template: { name: "celebrate", revision: 2 } }, admin))
    assert.equal((await f.routes())[0].time, "00:03")
})
test("Withdrawal before claim closes attempt, after claim preserves immutable truth and never restores enrollment", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0] as MilestonesDelivery, grant = (await read(await f.reserve(row))).grant
    await read(await f.personal({ type: "remove", kind: "all" }))
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    const old = (await f.deliveries())[0]!
    assert.equal(old.state, "cancelled")
    await read(await f.enroll())
    const profile = (await read(await f.personal({ type: "me" }))).enrollments[0]
    assert.equal(profile.monthDay, "01-01")
    // The configured minute already passed so the same-day re-enrollment cannot catch up
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
})
test("Claim then removal and late uncertain outcomes preserve truthful publisher snapshots and annual dedupe", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0], grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant))
    const before = await f.db.run(ctx => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    await read(await f.personal({ type: "remove", kind: "all" }))
    await read(await f.outcome(grant, "uncertain"))
    const after = await f.db.run(ctx => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    assert.deepEqual(after!.content, before!.content); assert.deepEqual(after!.consumer, before!.consumer)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    assert.equal((await f.db.run(ctx => ctx.db.query("milestoneEnrollments").collect())).length, 0)
    f.advance(31 * 86400000); await f.cleanup()
    assert.equal((await f.db.run(ctx => ctx.db.query("publishingAttempts").collect())).length, 1)
    assert.equal((await f.db.run(ctx => ctx.db.query("milestoneConsumed").collect())).length, 1)
    await read(await f.enroll()); f.advance(60000); await read(await f.delivery({ type: "list" }))
    assert((await f.deliveries()).some(r => r.celebrationYear === 2027))
})
test("Exact membership observations revoke old epochs, opaque errors reject and stale target preserves re-enrollment", async t => {
    const f = await fixture(t); await f.open()
    const targets = (await read(await f.delivery({ type: "member-targets", userId: "20" }))).targets
    assert.equal(targets.length, 1)
    await status(await f.delivery({ type: "member-observation", target: targets[0], observation: { observedAt: f.now(), userId: "20", status: "error" } }), 400)
    assert.equal((await read(await f.delivery({ type: "member-observation", target: targets[0], observation: { observedAt: f.now(), userId: "20", status: "present", joinedAt: "2024-01-01T00:00:00.000002Z" } }))).recorded, true)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    f.advance(1); await read(await f.enroll("birthday", "01-01", "20", f.participant("20", "2025-01-01T00:00:00.000003Z")))
    assert.equal((await read(await f.delivery({ type: "member-observation", target: targets[0], observation: { observedAt: f.now(), userId: "20", status: "absent" } }))).recorded, false)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 1)
})
test("Module, route and publisher activation fence undispatched reservations and shortened deadlines", async t => {
    for (const scope of ["module", "route", "publisher"]) {
        const f = await fixture(t); await f.open(); f.advance(120000)
        const row = (await read(await f.delivery({ type: "list" }))).deliveries[0], grant = (await read(await f.reserve(row))).grant
        if (scope === "module") { await read(await f.manage({ type: "settings", expectedRevision: 2, enabled: false })); await read(await f.manage({ type: "settings", expectedRevision: 3, enabled: true })) }
        if (scope === "route") { await read(await f.change("disable")); await read(await f.change("enable")) }
        if (scope === "publisher") { await read(await f.publish({ type: "settings", patch: { enabled: false } })); await read(await f.publish({ type: "settings", patch: { enabled: true } })) }
        assert.equal((await read(await f.dispatch(grant))).claimed, false)
        assert.equal((await f.deliveries())[0]!.reason, "activation-cutoff")
    }
})
test("Removal succeeds without membership or owner evidence at full account, delivery and receipt quota", async t => {
    const f = await fixture(t); await f.open()
    await f.db.run(async ctx => { const row = (await ctx.db.query("milestoneSettings").collect())[0]!; await ctx.db.patch(row._id, { accounts: 1000, deliveries: 4000, memberReceipts: 10000 }) })
    const result = await read(await f.personal({ type: "remove", kind: "all" }))
    assert.equal(result.removed, 1)
    assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    assert.equal((await f.db.run(ctx => ctx.db.query("milestoneEnrollments").collect())).length, 0)
})
test("Thirty-day cleanup retires settled owned publisher tracking and retains 400-day body-free fences", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0], grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant)); await read(await f.outcome(grant))
    f.advance(30 * 86400000 + 1); await f.cleanup()
    const state = await read(await f.query({ type: "status" }))
    assert.equal(state.deliveries, 0)
    assert.equal((await f.db.run(ctx => ctx.db.query("milestoneConsumed").collect())).length, 1)
    const me = await read(await f.personal({ type: "me" })); assert.equal(me.enrollments.length, 1)
    await read(await f.delivery({ type: "list" })); assert.equal((await f.deliveries())[0]!.celebrationYear, 2027)
})
test("Indexed fair source pages advance future checks and blocked head members without starving later due members", async t => {
    const f = await fixture(t); await f.open()
    for (let i = 21; i <= 43; i++) await read(await f.enroll("birthday", "01-01", String(i)))
    f.advance(120000)
    const first = await read(await f.delivery({ type: "list" }))
    assert.equal(first.deliveries.length, 20); assert.equal(first.hasMore, true)
    await read(await f.delivery({ type: "defer", binding: f.binding(first.deliveries[0]) }))
    const second = await read(await f.delivery({ type: "list", cursor: first.nextCursor }))
    assert.equal(second.deliveries.length, 4)
    const ids = [...first.deliveries, ...second.deliveries].map(row => row.userId)
    assert.equal(new Set(ids).size, 24)
    const sources = await f.db.run(ctx => ctx.db.query("milestoneEnrollments").collect())
    assert(sources.every(row => row.nextCheckAt > f.now()))
})
test("Concurrent recovery reserves one owned attempt and competing public dispatch claims grant only once", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    const reserved = await Promise.all([f.reserve(row).then(read), f.reserve(row).then(read)])
    assert.equal(reserved[0].grant.attemptId, reserved[1].grant.attemptId)
    const claims = await Promise.all([f.dispatch(reserved[0].grant).then(read), f.dispatch(reserved[1].grant).then(read)])
    assert.equal(claims.filter(claim => claim.claimed).length, 1)
    const current = await read(await f.query({ type: "status" }))
})
test("An exact expired claim cannot reopen or replay a consumed year", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000 + 270000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0], grant = (await read(await f.reserve(row))).grant
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    f.advance(180000)
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    const attempt = await f.db.run(ctx => ctx.db.get(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!))
    assert.equal(attempt!.noDispatch, true); assert.equal(attempt!.unresolved, false)
    f.advance(60000); await read(await f.delivery({ type: "list" }))
    assert.equal((await f.deliveries()).filter(row => row.celebrationYear === 2026).length, 1)
    assert((await f.deliveries()).some(row => row.celebrationYear === 2027 && row.state === "queued"))
})
test("Future template changes copy frozen annual instants without consulting changed timezone data", async t => {
    const f = await fixture(t); await f.open()
    const original = (await f.deliveries())[0]!, route = (await f.routes())[0]
    t.mock.method(Intl, "DateTimeFormat", () => { throw new Error("Synthetic changed timezone data") })
    await read(await f.configure("birthday", route.revision))
    f.advance(1000); await read(await f.delivery({ type: "list" }))
    f.advance(59000); await read(await f.delivery({ type: "list" }))
    const rows = await f.deliveries(), newest = rows.find(row => row.state === "queued")!
    assert.equal(newest.dueAt, original.dueAt); assert.equal(newest.offsetMinutes, original.offsetMinutes)
    assert.equal(rows.find(row => row.deliveryId === original.deliveryId)!.state, "superseded")
    assert(newest.intentRevision > route.intentRevision)
})
test("Fresh changed raw epoch revokes at reserve and claim even when the destination is no longer available", async t => {
    for (const phase of ["reserve", "claim"]) {
        const f = await fixture(t); await f.open(); f.advance(120000)
        const row = (await read(await f.delivery({ type: "list" }))).deliveries[0], proof = f.participant("20", "2024-01-01T00:00:00.000002Z")
        if (phase === "reserve") {
            const denied = { observedAt: f.now(), channelId: "31", botId: "999", botAuthorized: true }
            assert.equal((await read(await f.reserve(row, proof, denied))).status, "cancelled")
        } else {
            const grant = (await read(await f.reserve(row))).grant
            assert.equal((await read(await f.dispatch(grant, proof))).claimed, false)
        }
        assert.equal((await read(await f.personal({ type: "me" }))).enrollments.length, 0)
    }
})
test("Bot automation and participant remain independent fresh authority at every public automatic boundary", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    const botActor = { ...f.context(), member: { ...f.context().member!, isBot: true } }
    await status(await f.manage({ type: "settings", expectedRevision: 2, enabled: false }, botActor), 403)
    assert.equal((await read(await f.reserve(row, { ...f.participant(), member: { ...f.participant().member, canView: false } }))).status, "waiting")
    const grant = (await read(await f.reserve(row))).grant
    await status(await f.dispatch(grant, { ...f.participant(), member: { ...f.participant().member, timeoutUntil: new Date(f.now() + 60000).toISOString() } }), 403)
    await status(await f.dispatch(grant, { ...f.participant(), observedAt: f.now() - 60001 }), 400)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
})
test("A birthday hours late still sends on its local day", async t => {
    const f = await fixture(t); await f.open(); f.advance(120000 + 6 * 3600000)
    const row = (await read(await f.delivery({ type: "list" }))).deliveries[0]
    assert.equal(row.celebrationYear, 2026)
    const grant = (await read(await f.reserve(row))).grant
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
})
test("A birthday missed for its whole local day skips without consuming the annual fence", async t => {
    const f = await fixture(t); await f.open(); f.advance(86400000)
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
    const rows = await f.deliveries()
    assert.equal(rows.find(row => row.celebrationYear === 2026)!.reason, "late-window")
    assert(rows.some(row => row.celebrationYear === 2027 && row.state === "queued"))
    assert.equal((await f.db.run(ctx => ctx.db.query("milestoneConsumed").collect())).length, 0)
})
test("Enrollments wait for their next due time and a changed route re-arms them", async t => {
    const f = await fixture(t); await f.open()
    await read(await f.enroll("birthday", "06-01", "21"))
    const source = async () => (await f.db.run(ctx => ctx.db.query("milestoneEnrollments").collect())).find(row => row.userId === "21")!
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:02Z"))
    f.advance(120000); await read(await f.delivery({ type: "list" }))
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:02Z"))
    await read(await f.configure("birthday", (await f.routes())[0].revision, "30", "UTC", "00:05"))
    assert.equal((await source()).nextCheckAt, f.now())
    await read(await f.delivery({ type: "list" }))
    assert.equal((await source()).nextCheckAt, Date.parse("2026-06-01T00:05Z"))
})
