import assert from "node:assert/strict"
import type { Types } from "effect"
import test from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { makeFunctionReference } from "convex/server"
import { cleanup } from "../convex/milestonesCleanup.ts"
import type { MilestonesContext, MilestonesDelivery, MilestonesDeliveryContext, MilestonesDeliveryGrant, MilestonesDeliveryRequest, MilestonesDeliveryResult, MilestonesDmIdentity, MilestonesManageOperation, MilestonesManageRequest, MilestonesManageResult, MilestonesParticipantContext, MilestonesPersonalRequest, MilestonesPersonalResult, MilestonesQueryRequest, MilestonesQueryResult, MilestonesRoute } from "@neonflux/contracts/milestones"
import type { PublishingDispatchRequest, PublishingDispatchResult, PublishingDraft, PublishingManageOperation, PublishingManageResult, PublishingOutcomeRequest, PublishingOutcomeResult, PublishingQueryResult } from "@neonflux/contracts/publishing"
import type { MilestonesDeliveryBinding, MilestonesKind } from "@neonflux/contracts/publishing-base"
import type { EventsMemberContext, ModerationActor } from "@neonflux/contracts/shared"
import { adapterFixture } from "./adapter-fixture.ts"
import { createMilestonesStore, MilestonesStoreError } from "../../bot/src/milestone-store.ts"
import { createPublishingStore, PublishingStoreError } from "../../bot/src/publishing-store.ts"
import { processMilestonesPass } from "../../bot/src/milestone-worker.ts"
import { readMilestoneMembership, verifyMilestonePrivateAuthor } from "../../bot/src/milestone-permissions.ts"
import { observeMilestoneDeparture } from "../../bot/src/milestone-events.ts"
import { handleMilestoneCommand } from "../../bot/src/milestone-management.ts"
import { parseMilestoneCommand } from "../../bot/src/milestone-command.ts"

const modules = {
    "../convex/milestones.ts": () => import("../convex/milestones.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/milestonesCleanup.ts": () => import("../convex/milestonesCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
}
const rawEpoch = "2020-02-29T00:30:00.123456789+00:00"
const actor: ModerationActor = { originServerId: "1", userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const owner: ModerationActor = { ...actor, userId: "10", isOwner: true }
const admin: ModerationActor = { ...actor, userId: "11", isAdministrator: true }
const member = (userId = "20", joinedAt = rawEpoch): EventsMemberContext => ({ userId, joinedAt, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true })
assert.equal(cleanup.isInternal, true, "Milestone cleanup is an exported internal mutation")

function routeResult(result: MilestonesManageResult) {
    assert(!result.duplicate && result.type === "route")
    return result.route
}
function enrollmentResult(result: MilestonesPersonalResult) {
    assert(!result.duplicate && result.type === "enrollment")
    return result.enrollment
}
function binding(value: MilestonesDelivery): MilestonesDeliveryBinding {
    const { deliveryId, kind, intentRevision, userId, joinedAt, consentRevision, audienceGeneration, celebrationYear, completedYears, generation } = value
    return { deliveryId, kind, intentRevision, userId, joinedAt, consentRevision, audienceGeneration, celebrationYear, completedYears, generation }
}
function publishingBinding(grant: MilestonesDeliveryGrant, claimToken = "a".repeat(32)) {
    return { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken }
}
async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Clock, Effect, Exit, Deferred, Fiber, Random, Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Clock, Effect, Exit, Deferred, Fiber, Random, Redacted, TestClock, Permissions, createTestBot }
}

async function withNative(f: Awaited<ReturnType<typeof fixture>>, body: (runtime: Awaited<ReturnType<typeof sdk>>, bot: any) => any, onRetry?: (delay: number) => void) {
    const runtime = await sdk(), { Clock, Effect, Random, TestClock, Permissions, createTestBot } = runtime
    return f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        // Wall time binds backend deadlines. Give SDK monotonic time its own zero origin so nanosecond conversion stays exact.
        const clock = yield* Clock.Clock, origin = clock.monotonicTimeNanosUnsafe()
        const monotonicTimeNanosUnsafe = () => clock.monotonicTimeNanosUnsafe() - origin
        const sdkClock = { ...clock, monotonicTimeNanosUnsafe, monotonicTimeNanos: Effect.sync(monotonicTimeNanosUnsafe) }
        const bot = yield* createTestBot({ token: "synthetic-milestones-adapter-sdk-token", ...(onRetry ? { logging: { level: "debug", dedupe: false, sink: (record: { code: string, delayMs?: number }) => { if (record.code === "rest.retry") onRetry(record.delayMs!) } } } : {}) }).pipe(Effect.provideService(Clock.Clock, sdkClock)), native = bot.fixtures
        const adminRole = native.role({ permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory).toString() })
        const everyone = native.role({ id: "1", permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10", name: "Synthetic <server>" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [everyone, adminRole, botRole] })
        for (const userId of ["10", "11"]) bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user: native.user({ id: userId }), roles: [adminRole.id], joined_at: rawEpoch, communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], joined_at: rawEpoch, communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/20", { body: native.member({ user: native.user({ id: "20", username: "Synthetic *member* @everyone" }), roles: [], joined_at: rawEpoch, communication_disabled_until: null }) })
        bot.rest.respond("GET /channels/30", { body: native.channel({ id: "30", guild_id: "1" }) })
        bot.rest.respond("GET /channels/600", { body: { id: "600", type: 1, recipients: [native.user({ id: "20" })], last_message_id: null } })
        yield* body(runtime, bot)
    })).pipe(Random.withSeed("synthetic-milestone-sdk-retry"), Effect.provide(TestClock.layer())))
}

async function fixture(t: Parameters<typeof adapterFixture>[0], instant = "2026-01-01T00:00Z") {
    const f = await adapterFixture(t, modules)
    f.advance(Date.parse(instant) - f.now())
    const store = createMilestonesStore(f.config), wrongStore = createMilestonesStore(f.wrongConfig), publishing = createPublishingStore(f.config)
    const context = (who = owner, channelId = "30"): MilestonesContext => ({ observedAt: f.now(), actor: who, channelId, botId: "999", botAuthorized: true, actorAuthorized: true, member: member(who.userId) })
    const identity = (userId = "20"): MilestonesDmIdentity => ({ userId, channelId: "600", isDirectMessage: true, isBot: false, observedAt: f.now() })
    const participant = (userId = "20", joinedAt = rawEpoch, channelId = "30"): MilestonesParticipantContext => ({ observedAt: f.now(), channelId, botId: "999", member: member(userId, joinedAt), userName: "Synthetic *member* @everyone", serverName: "Synthetic <server>" })
    const manageInput = (operation: MilestonesManageOperation, current = context()): MilestonesManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: MilestonesManageOperation, current = context()) => f.run<MilestonesManageResult>(store.manage(manageInput(operation, current)))
    const queryInput = (operation: MilestonesQueryRequest["operation"], current = context()): MilestonesQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: MilestonesQueryRequest["operation"], current = context()) => f.run<MilestonesQueryResult>(store.query(queryInput(operation, current)))
    const status = async () => { const result = await query({ type: "status" }); assert.equal(result.type, "status"); return result }
    const personalInput = (operation: MilestonesPersonalRequest["operation"], userId = "20"): MilestonesPersonalRequest => ({ ...f.source(), identity: identity(userId), operation })
    const personal = (operation: MilestonesPersonalRequest["operation"], userId = "20") => f.run<MilestonesPersonalResult>(store.personal(personalInput(operation, userId)))
    const me = async (userId = "20") => { const value = await personal({ type: "me" }, userId); assert(!value.duplicate && value.type === "me"); return value }
    const delivery = (operation: MilestonesDeliveryRequest["operation"]) => f.run<MilestonesDeliveryResult>(store.delivery({ serverId: "1", operation }))
    const deliveries = async (kind: MilestonesKind = "birthday") => {
        const rows: MilestonesDelivery[] = []
        let cursor: string | undefined
        for (let page = 0; page < 12; page++) {
            const value = await query({ type: "deliveries", kind, ...(cursor === undefined ? {} : { cursor }) })
            assert.equal(value.type, "deliveries")
            assert(value.deliveries.length <= 10)
            rows.push(...value.deliveries)
            if (value.nextCursor === undefined) return rows
            assert.notEqual(value.nextCursor, cursor, "Retained cursor must advance")
            cursor = value.nextCursor
        }
        assert.fail("Targeted fixture must finish retained pagination")
    }
    const route = async (kind: MilestonesKind = "birthday") => {
        const value = await query({ type: "settings" }); assert.equal(value.type, "settings")
        const selected = value.routes.find(row => row.kind === kind); assert(selected)
        return selected
    }
    const publishingManage = (operation: PublishingManageOperation) => f.run<PublishingManageResult>(publishing.manage({ ...f.source(), actor: owner, operation }))
    const template = async (kind: MilestonesKind = "birthday", content = kind === "birthday" ? "Celebrate {user} in {server}" : "Celebrate {user}: {years} completed years in {server}") => {
        const name = `synthetic-${kind}-${f.source().messageId}`
        const created = await publishingManage({ type: "draft-create", kind: "template", name }); assert(!created.duplicate && created.type === "draft")
        const updated = await publishingManage({ type: "draft-update", kind: "template", name, expectedRevision: created.draft.revision, edit: { type: "content", content } }); assert(!updated.duplicate && updated.type === "draft")
        return updated.draft
    }
    const configure = async (kind: MilestonesKind = "birthday", options: Partial<Pick<MilestonesRoute, "channelId" | "zone" | "time" | "fold">> = {}, selected?: PublishingDraft) => {
        const value = await query({ type: "settings" }); assert.equal(value.type, "settings")
        const old = value.routes.find(row => row.kind === kind), source = selected ?? await template(kind)
        return routeResult(await manage({ type: "configure", kind, expectedRevision: old?.revision ?? 0, channelId: "30", zone: "UTC", time: "09:00", fold: "reject", ...options, template: { name: source.name, revision: source.revision } }, context(owner, options.channelId ?? "30")))
    }
    const enable = async (kind: MilestonesKind = "birthday") => {
        const value = await query({ type: "settings" }); assert.equal(value.type, "settings")
        if (!value.settings.enabled) await manage({ type: "settings", expectedRevision: value.settings.revision, enabled: true })
        const current = await route(kind)
        return routeResult(await manage({ type: "enable", kind, expectedRevision: current.revision }, context(owner, current.channelId)))
    }
    const enroll = (kind: MilestonesKind = "birthday", monthDay = "01-02", userId = "20", joinedAt = rawEpoch, channelId = "30") => personal(kind === "birthday"
        ? { type: "enroll", kind, monthDay, confirmChannelId: channelId, participant: participant(userId, joinedAt, channelId) }
        : { type: "enroll", kind, confirmChannelId: channelId, participant: participant(userId, joinedAt, channelId) }, userId).then(enrollmentResult)
    const open = async (kind: MilestonesKind = "birthday", monthDay = "01-02", options: Partial<Pick<MilestonesRoute, "channelId" | "zone" | "time" | "fold">> = {}, joinedAt = rawEpoch) => {
        await configure(kind, options); const configured = await enable(kind)
        await enroll(kind, monthDay, "20", joinedAt, configured.channelId)
        return configured
    }
    const workerContext = (row: MilestonesDelivery): MilestonesDeliveryContext => ({
        automation: { observedAt: f.now(), channelId: row.channelId, botId: "999", botAuthorized: true }, participant: participant(row.userId, row.joinedAt, row.channelId) })
    const reserve = async (row: MilestonesDelivery, current = workerContext(row)) => {
        const value = await delivery({ type: "reserve", binding: binding(row), context: current }); assert(value.type === "reservation" && value.status === "reserved")
        return value.grant
    }
    const post = async (postNo: number) => { const value = await f.run<PublishingQueryResult>(publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo } })); assert.equal(value.type, "post"); return value.post }
    const dispatch = (grant: MilestonesDeliveryGrant, row: MilestonesDelivery, current = workerContext(row), token = "a".repeat(32)) => f.run<PublishingDispatchResult>(publishing.dispatch({ ...publishingBinding(grant, token), milestoneContext: current }))
    const outcome = (grant: MilestonesDeliveryGrant, result: PublishingOutcomeRequest["outcome"], messageId?: string) => f.run<PublishingOutcomeResult>(publishing.outcome({ ...publishingBinding(grant), outcome: result, ...(messageId === undefined ? {} : { messageId }) }))
    const sent = async (row: MilestonesDelivery) => { const grant = await reserve(row); assert((await dispatch(grant, row)).claimed); assert.deepEqual(await outcome(grant, "sent", f.source().messageId), { recorded: true }); return grant }
    const cleanup = () => f.backend.mutation(makeFunctionReference<"mutation">("milestonesCleanup:cleanup"), {})
    return { ...f, store, wrongStore, publishing, context, identity, participant, manageInput, manage, queryInput, query, status, personalInput, personal, me, delivery, deliveries, route, publishingManage, template, configure, enable, enroll, open, workerContext, reserve, post, dispatch, outcome, sent, cleanup }
}

test("milestones authenticate all adapters and preserve disabled defaults on rejected requests", async t => {
    const f = await fixture(t), before = await f.status()
    assert.equal(before.settings.enabled, false)
    assert.equal(before.settings.revision, 1)
    assert.equal(before.accounts, 0)
    assert.equal(before.enrollments, 0)
    assert.equal(before.deliveries, 0)
    for (const effect of [
        f.wrongStore.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true })),
        f.wrongStore.query(f.queryInput({ type: "settings" })),
        f.wrongStore.personal(f.personalInput({ type: "me" })),
        f.wrongStore.delivery({ serverId: "1", operation: { type: "list" } }),
    ]) await f.reject(effect, MilestonesStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), MilestonesStoreError, 403)
    await f.reject(f.store.personal({ ...f.personalInput({ type: "me" }), serverId: "2" }), MilestonesStoreError, 403)
    await f.reject(f.store.manage(f.manageInput({ type: "settings", expectedRevision: 1, enabled: true }, f.context(actor))), MilestonesStoreError, 403)
    assert.deepEqual(await f.status(), before)
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)), new Set(["/milestones/manage", "/milestones/query", "/milestones/personal", "/milestones/delivery"]))
})

test("personal consent binds authenticated DM account, exact destination and month/day without accepting year or staff enrollment", async t => {
    const f = await fixture(t); await f.configure()
    const before = await f.status()
    const operation: Extract<MilestonesPersonalRequest["operation"], { type: "enroll", kind: "birthday" }> = { type: "enroll", kind: "birthday", monthDay: "02-29", confirmChannelId: "30", participant: f.participant() }
    for (const monthDay of ["2000-02-29", "02-30", "13-01", "00-00", "2-29", "18"]) await f.reject(f.store.personal(f.personalInput({ ...operation, monthDay })), MilestonesStoreError, 400)
    await f.reject(f.store.personal(f.personalInput({ ...operation, confirmChannelId: "31" })), MilestonesStoreError, 409)
    await f.reject(f.store.personal(f.personalInput({ ...operation, participant: f.participant("21") })), MilestonesStoreError, 403)
    // The contract allows only a human DM identity, so these are malformed. The participant check above refuses another member
    await f.reject(f.store.personal({ ...f.personalInput(operation), identity: { ...f.identity(), isDirectMessage: false } } as unknown as MilestonesPersonalRequest), MilestonesStoreError, 400)
    await f.reject(f.store.personal({ ...f.personalInput(operation), identity: { ...f.identity(), isBot: true } } as unknown as MilestonesPersonalRequest), MilestonesStoreError, 400)
    assert.deepEqual(await f.status(), before)
    const input = f.personalInput(operation), accepted = enrollmentResult(await f.run<MilestonesPersonalResult>(f.store.personal(input)))
    assert.equal(accepted.monthDay, "02-29")
    assert.equal(accepted.joinedAt, rawEpoch)
    assert.equal(accepted.channelId, "30")
    assert.deepEqual(await f.run<MilestonesPersonalResult>(f.store.personal(input)), { duplicate: true })
    await f.reject(f.store.personal({ ...input, operation: { ...operation, monthDay: "02-28" } }), MilestonesStoreError, 409)
    assert.equal((await f.me()).enrollments.length, 1)
    assert.equal((await f.me("21")).enrollments.length, 0)
    assert(!("year" in accepted) && !("age" in accepted))
})

test("destination changes including return invalidate consent while exact template intent stays frozen", async t => {
    const f = await fixture(t), selected = await f.template()
    const first = await f.configure("birthday", {}, selected); await f.enable(); const enrolled = await f.enroll()
    await f.publishingManage({ type: "draft-update", kind: "template", name: selected.name, expectedRevision: selected.revision, edit: { type: "content", content: "A later source edit" } })
    await f.publishingManage({ type: "draft-delete", kind: "template", name: selected.name, expectedRevision: selected.revision + 1 })
    assert.deepEqual((await f.route()).content, first.content)
    assert.deepEqual((await f.route()).canonicalContent, first.canonicalContent)
    const next = await f.configure("birthday", { channelId: "31" })
    assert(next.audienceGeneration > enrolled.audienceGeneration)
    assert.equal((await f.me()).enrollments[0]!.needsReconsent, true)
    await f.reject(f.store.personal(f.personalInput({ type: "enroll", kind: "birthday", monthDay: "01-02", confirmChannelId: "30", participant: f.participant() })), MilestonesStoreError, 409)
    const changed = await f.enroll("birthday", "01-02", "20", rawEpoch, "31")
    assert.equal(changed.audienceGeneration, next.audienceGeneration)
    assert.equal(changed.needsReconsent, false)
    const returned = await f.configure("birthday", { channelId: "30" })
    assert(returned.audienceGeneration > next.audienceGeneration)
    assert.equal((await f.me()).enrollments[0]!.needsReconsent, true)
    const accepted = await f.enroll()
    assert.equal(accepted.audienceGeneration, returned.audienceGeneration)
    assert.equal(accepted.needsReconsent, false)
})

test("annual persisted dates cover leap fallback, civil anniversary and explicit DST skips", async t => {
    const f = await fixture(t)
    await f.open("birthday", "02-29")
    const leap = (await f.deliveries()).find(row => row.state === "queued")!
    assert(leap)
    assert.equal(leap.celebrationYear, 2026)
    assert.equal(leap.dueAt, Date.parse("2026-02-28T09:00Z"))
    await f.open("anniversary", "", { zone: "America/New_York" }, "2024-03-01T00:30:00.123456789Z")
    // At UTC New Year the route is still in its prior civil year. Progress that past annual slot once.
    f.advance(60000); await f.delivery({ type: "list" })
    const anniversary = (await f.deliveries("anniversary")).find(row => row.state === "queued")!
    assert.equal(anniversary.dueAt, Date.parse("2026-02-28T14:00Z"))
    assert.equal(anniversary.completedYears, 2)
    await f.personal({ type: "remove", kind: "birthday" })
    await f.configure("birthday", { zone: "Europe/Berlin", time: "02:30", fold: "reject" })
    await f.enroll("birthday", "03-29")
    const skipped = (await f.deliveries()).find(row => row.reason === "civil-gap")
    assert(skipped)
    assert.equal(skipped.state, "skipped")
    assert.equal(skipped.celebrationYear, 2026)
    assert.equal(skipped.postNo, undefined)
    f.advance(60000)
    await f.delivery({ type: "list" })
    const following = (await f.deliveries()).find(row => row.state === "queued" && row.celebrationYear === 2027)
    assert(following, "Gap must advance to the next future annual slot without a shifted send")
})

test("withdrawal closes an undispatched reservation and physically deletes birthday enrollment without owner or membership proof", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now()); const grant = await f.reserve(row)
    const snapshot = (await f.post(grant.postNo)).attempt.content
    const removed = await f.personal({ type: "remove", kind: "birthday" })
    assert(!removed.duplicate && removed.type === "removed" && removed.removed === 1)
    assert.deepEqual((await f.me()).enrollments, [])
    assert.equal((await f.dispatch(grant, row)).claimed, false)
    const post = await f.post(grant.postNo)
    assert.equal(post.attempt.noDispatch, true)
    assert.equal(post.attempt.dispatchedAt, undefined)
    assert.equal(post.attempt.outcome, "failed")
    assert.deepEqual(post.attempt.content, snapshot)
    assert.equal((await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!.state, "cancelled")
    assert.equal((await f.status()).accounts, 0)
    assert.equal((await f.status()).enrollments, 0)
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("milestoneEnrollments").collect()), [])
})

test("claim wins withdrawal ordering and old late outcome preserves immutable publisher audit without recreating enrollment", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now()); const grant = await f.reserve(row)
    assert((await f.dispatch(grant, row)).claimed)
    const audit = (await f.post(grant.postNo)).attempt
    await f.personal({ type: "remove", kind: "all" })
    await f.configure("birthday", { channelId: "31", time: "10:00" })
    f.advance(grant.dispatchExpiresAt + 10001 - f.now())
    // The existing publisher lifecycle ages the claim, then its exact callback appends provider evidence.
    await f.backend.mutation(makeFunctionReference<"mutation">("publishing:cleanup"), {})
    const aged = await f.post(grant.postNo)
    assert.equal(aged.attempt.outcome, "uncertain")
    assert.equal(aged.messageId, undefined)
    assert.deepEqual(await f.outcome(grant, "sent", "2000"), { recorded: true })
    const late = await f.post(grant.postNo)
    assert.equal(late.attempt.outcome, "sent")
    assert.equal(late.attempt.messageId, "2000")
    for (const field of ["source", "sourceId", "content", "canonicalContent", "consumer", "provenance", "dispatchedAt", "generation", "attemptId"] as const) assert.deepEqual(late.attempt[field], audit[field])
    assert.deepEqual((await f.me()).enrollments, [])
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("milestoneEnrollments").collect()), [])
    assert.deepEqual(await f.outcome(grant, "sent", "2000"), { recorded: false })
    await f.reject(f.publishing.outcome({ ...publishingBinding(grant), outcome: "sent", messageId: "2001" }), PublishingStoreError, 409)
})

test("annual consumed fences survive removal and re-enrollment before a later same-year birthday minute", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now()); const grant = await f.sent(row)
    await f.personal({ type: "remove", kind: "birthday" })
    await f.configure("birthday", { time: "10:00" }); const enrolled = await f.enroll()
    assert(enrolled.revision > row.consentRevision)
    f.advance(60000); await f.delivery({ type: "list" })
    const fresh = (await f.deliveries()).filter(value => value.consentRevision === enrolled.revision)
    assert(!fresh.some(value => value.celebrationYear === row.celebrationYear && ["queued", "blocked", "reserved"].includes(value.state)), "Same annual birthday cannot replay through later time or re-enrollment")
    assert(fresh.some(value => value.celebrationYear === 2027 && value.state === "queued"))
    assert.equal((await f.post(grant.postNo)).outcome, "sent")
    const fences = await f.backend.run(ctx => ctx.db.query("milestoneConsumed").collect())
    assert.equal(fences.length, 1)
    assert.equal(fences[0]!.epoch, "")
    assert.equal(fences[0]!.year, 2026)
    assert.equal(fences[0]!.expiresAt - fences[0]!.createdAt, 400 * 86400000)
    assert(!JSON.stringify(fences).includes("monthDay"))
})

test("anniversary dedupe binds raw epoch and completed civil year independently from birthday year", async t => {
    const f = await fixture(t); await f.open("anniversary", "", {}, "2024-01-02T00:00:00.123456789Z")
    const row = (await f.deliveries("anniversary")).find(value => value.state === "queued")!
    assert.equal(row.completedYears, 2)
    f.advance(row.dueAt - f.now()); await f.sent(row)
    await f.personal({ type: "remove", kind: "anniversary" })
    await f.configure("anniversary", { time: "10:00" })
    await f.enroll("anniversary", "", "20", row.joinedAt)
    f.advance(60000); await f.delivery({ type: "list" })
    assert(!(await f.deliveries("anniversary")).some(value => value.completedYears === 2 && value.state === "queued"))
    const fences = await f.backend.run(ctx => ctx.db.query("milestoneConsumed").collect())
    assert.equal(fences[0]!.epoch, row.joinedAt)
    assert.equal(fences[0]!.year, 2)
})

for (const scope of ["route", "module", "publisher"] as const) {
    test(`milestone ${scope} activation cutoff fences existing unclaimed attempts and future reservations`, async t => {
        const f = await fixture(t); await f.open(); await f.enroll("birthday", "01-02", "21")
        const rows = await f.deliveries(), row = rows.find(value => value.userId === "20" && value.state === "queued")!, neverReserved = rows.find(value => value.userId === "21" && value.state === "queued")!
        f.advance(row.dueAt - f.now()); const grant = await f.reserve(row)
        if (scope === "route") {
            const current = await f.route(), disabled = routeResult(await f.manage({ type: "disable", kind: "birthday", expectedRevision: current.revision }))
            f.advance(1); await f.manage({ type: "enable", kind: "birthday", expectedRevision: disabled.revision })
        } else if (scope === "module") {
            const current = await f.status(), disabled = await f.manage({ type: "settings", expectedRevision: current.settings.revision, enabled: false })
            assert(!disabled.duplicate && disabled.type === "settings")
            f.advance(1); await f.manage({ type: "settings", expectedRevision: disabled.settings.revision, enabled: true })
        } else {
            await f.publishingManage({ type: "settings", patch: { enabled: false } })
            f.advance(1); await f.publishingManage({ type: "settings", patch: { enabled: true } })
        }
        assert.equal((await f.dispatch(grant, row)).claimed, false)
        const closed = await f.post(grant.postNo)
        assert.equal(closed.attempt.noDispatch, true)
        assert.equal(closed.attempt.dispatchedAt, undefined)
        const retained = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
        assert.equal(retained.reason, "activation-cutoff")
        assert.equal(retained.state, "skipped")
        assert.deepEqual(await f.delivery({ type: "reserve", binding: binding(row), context: f.workerContext(row) }), { type: "reservation", status: "terminal" })
        assert.deepEqual(await f.delivery({ type: "reserve", binding: binding(neverReserved), context: f.workerContext(neverReserved) }), { type: "reservation", status: "skipped" })
        const excluded = (await f.deliveries()).find(value => value.deliveryId === neverReserved.deliveryId)!
        assert.equal(excluded.reason, "activation-cutoff")
        assert.equal(excluded.postNo, undefined)
        assert(!f.calls.some(call => /search|adopt|delete/.test(call.path)))
    })
}

test("milestone recovery retains the exact unclaimed attempt, late expiry and one-time dispatch", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt + 270000 - f.now()); const grant = await f.reserve(row)
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    const before = await f.status()
    assert.deepEqual(await f.reserve(row), grant)
    assert.deepEqual(await f.status(), before)
    assert((await f.dispatch(grant, row)).claimed)
    assert.equal((await f.dispatch(grant, row, f.workerContext(row), "b".repeat(32))).claimed, false)
    assert.deepEqual(await f.outcome(grant, "uncertain"), { recorded: true })
    f.advance(60000)
    const listed = await f.delivery({ type: "list" }); assert.equal(listed.type, "deliveries")
    assert(!listed.deliveries.some(value => value.deliveryId === row.deliveryId))
    assert.equal((await f.post(grant.postNo)).outcome, "uncertain")
})

test("milestone exact deadline forbids a native claim and cannot reopen expired undispatched work", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt + 290000 - f.now()); const grant = await f.reserve(row)
    f.advance(grant.dispatchExpiresAt - f.now())
    assert.equal((await f.dispatch(grant, row)).claimed, false)
    const post = await f.post(grant.postNo)
    assert.equal(post.attempt.noDispatch, true)
    assert.equal(post.attempt.dispatchedAt, undefined)
    assert.deepEqual(await f.delivery({ type: "reserve", binding: binding(row), context: f.workerContext(row) }), { type: "reservation", status: "terminal" })
})

test("actual milestone ready-list adapter reaches worker, protected publisher and native SDK transport once", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now())
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = bot.fixtures
        const send = bot.rest.respond("POST /channels/30/messages", (request: { body: { content: string } }) => ({ body: native.message({ id: "2000", guild_id: "1", channel_id: "30", author: native.botUser({ id: "999" }), content: request.body.content }) }))
        let discovered: MilestonesDelivery[] = []
        const actual = createMilestonesStore(f.config)
        const observed = { ...actual, delivery: (input: MilestonesDeliveryRequest) => actual.delivery(input).pipe(Effect.tap((result: MilestonesDeliveryResult) => Effect.sync(() => {
            if (input.operation.type === "list" && result.type === "deliveries") {
                discovered = result.deliveries
                assert.equal(discovered.length, 1)
                assert.equal(discovered[0]!.deliveryId, row.deliveryId)
                assert.equal(discovered[0]!.userId, "20")
                assert.equal(discovered[0]!.joinedAt, rawEpoch)
                assert.equal(discovered[0]!.dueAt, f.now())
            }
        }))) }
        const before = f.calls.length
        const pass = yield* processMilestonesPass(observed, f.publishing, "1", bot.client)
        assert.equal(pass.considered, 1)
        assert.equal(pass.hasMore, false)
        assert.equal(send.requests().length, 1)
        const body = send.requests()[0]!.body as { content: string, allowed_mentions: unknown }
        assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert(!body.content.includes("01-02") && !body.content.includes("2020"))
        assert.deepEqual(f.calls.slice(before).map(call => call.path), ["/milestones/delivery", "/milestones/delivery", "/publishing/dispatch", "/publishing/outcome"])
        const again = yield* processMilestonesPass(actual, f.publishing, "1", bot.client)
        assert.equal(again.considered, 0)
        assert.equal(send.requests().length, 1)
        assert(!bot.requests().some((request: { method: string }) => ["PATCH", "DELETE"].includes(request.method)))
    }))
    const delivered = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
    assert.equal(delivered.state, "sent")
    assert.equal(delivered.claimedAt, f.now())
    assert(delivered.postNo)
    const post = await f.post(delivered.postNo)
    assert.equal(post.messageId, "2000")
    assert.equal(post.attempt.source?.type, "milestone-timer")
    assert.deepEqual(post.consumer, { type: "milestone", ...binding(row) })
    assert.equal(post.attempt.dispatchedAt, f.now())
})

for (const lateness of [0, 270000]) {
    test(`actual milestone worker accepts awaited reservation latency with ${lateness}ms lateness and exact expiry`, async t => {
        const f = await fixture(t); await f.open()
        const row = (await f.deliveries()).find(value => value.state === "queued")!
        f.advance(row.dueAt - 1 - f.now())
        const reservations: MilestonesDeliveryGrant[] = []
        await withNative(f, ({ Clock, Effect, TestClock }, bot) => Effect.gen(function* () {
            const send = bot.rest.respond("POST /channels/30/messages", (request: { body: { content: string } }) => ({ body: bot.fixtures.message({ id: "2000", guild_id: "1", channel_id: "30", author: bot.fixtures.botUser({ id: "999" }), content: request.body.content }) }))
            const actual = createMilestonesStore(f.config), claims: PublishingDispatchResult[] = []
            const delayed = { ...actual, delivery: (input: MilestonesDeliveryRequest) => Effect.gen(function* () {
                if (input.operation.type === "reserve") {
                    // Advance both controlled clocks after authorization, before the real backend reserves.
                    f.advance(1); yield* TestClock.adjust("1 millis")
                    assert.equal(yield* Clock.currentTimeMillis, f.now())
                }
                const result = yield* actual.delivery(input)
                if (input.operation.type === "reserve") {
                    assert(result.type === "reservation" && result.status === "reserved")
                    const reserved = result.grant
                    reservations.push(reserved)
                    assert.equal(reserved.dispatchExpiresAt, f.now() + 180000)
                }
                return result
            }) }
            const publishing = { ...f.publishing, dispatch: (input: PublishingDispatchRequest) => f.publishing.dispatch(input).pipe(Effect.tap((claim: PublishingDispatchResult) => Effect.sync(() => { claims.push(claim) }))) }
            const early = yield* processMilestonesPass(delayed, publishing, "1", bot.client)
            assert.equal(early.considered, 0, "Future annual work must remain undiscovered")
            assert.equal(reservations.length, 0)
            assert.equal(claims.length, 0)
            assert.equal(send.requests().length, 0)
            f.advance(lateness + 1); yield* TestClock.adjust(`${lateness + 1} millis`)
            const before = f.calls.length
            const pass = yield* processMilestonesPass(delayed, publishing, "1", bot.client)
            assert.equal(pass.considered, 1)
            assert.equal(pass.hasMore, false)
            assert.equal(reservations.length, 1)
            const reserved = reservations[0]!
            assert.deepEqual(claims, [{ claimed: true, dispatchExpiresAt: reserved.dispatchExpiresAt, nativeDeadlineMs: 5000 }])
            assert.equal(send.requests().length, 1)
            assert.deepEqual(f.calls.slice(before).map(call => call.path), ["/milestones/delivery", "/milestones/delivery", "/publishing/dispatch", "/publishing/outcome"])
            const restarted = yield* processMilestonesPass(createMilestonesStore(f.config), createPublishingStore(f.config), "1", bot.client)
            assert.equal(restarted.considered, 0)
            assert.equal(claims.length, 1)
            assert.equal(send.requests().length, 1)
        }))
        const reserved = reservations[0]!
        const delivered = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
        assert.equal(delivered.state, "sent")
        assert.equal(delivered.claimedAt, row.dueAt + lateness + 1)
        assert.equal(delivered.postNo, reserved.postNo)
        assert.equal(delivered.attemptId, reserved.attemptId)
        const post = await f.post(reserved.postNo)
        assert.equal(post.messageId, "2000")
        assert.equal(post.attempt.outcome, "sent")
        assert.equal(post.attempt.dispatchedAt, delivered.claimedAt)
        assert.equal(post.attempt.dispatchExpiresAt, reserved.dispatchExpiresAt)
        assert.deepEqual(post.attempt.source, { type: "milestone-timer", deliveryId: row.deliveryId, dueAt: row.dueAt })
        assert.deepEqual(post.consumer, { type: "milestone", ...binding(row) })
    })
}

for (const nativeStatus of [403, 500, 404]) {
    test(`actual milestone worker treats participant ${nativeStatus} as ${nativeStatus === 404 ? "typed absence" : "opaque deferral"}`, async t => {
        const f = await fixture(t); await f.open()
        const row = (await f.deliveries()).find(value => value.state === "queued")!
        f.advance(row.dueAt - f.now())
        // The installed SDK has two bounded GET retries. Synchronize on its public retry records and drive their clock.
        const retryBarriers = Array.from({ length: 2 }, () => {
            let resolve!: (delay: number) => void
            const promise = new Promise<number>(done => { resolve = done })
            return { promise, resolve }
        })
        let retryCount = 0
        await withNative(f, ({ Effect, Fiber, TestClock }, bot) => Effect.gen(function* () {
            const membership = bot.rest.respond("GET /guilds/1/members/20", { status: nativeStatus, body: { message: "Synthetic opaque provider body must not persist" } })
            const send = bot.rest.respond("POST /channels/30/messages", { status: 500, body: { message: "Synthetic unexpected write" } })
            const running = yield* Effect.forkChild(processMilestonesPass(f.store, f.publishing, "1", bot.client))
            if (nativeStatus === 500) for (const barrier of retryBarriers) {
                const delay = yield* Effect.promise(() => barrier.promise)
                assert(Number.isSafeInteger(delay) && delay > 0 && delay <= 500)
                f.advance(delay); yield* TestClock.adjust(`${delay} millis`)
            }
            const pass = yield* Fiber.join(running)
            assert.equal(pass.considered, 1)
            assert.equal(membership.requests().length, nativeStatus === 500 ? 3 : 1)
            assert.equal(send.requests().length, 0)
            assert(!bot.requests().some((request: { path: string }) => request.path === "/guilds/1/members/10"), "Participant absence/error is handled before owner proof")
        }), nativeStatus === 500 ? delay => { assert(retryCount < 2); retryBarriers[retryCount++]!.resolve(delay) } : undefined)
        assert.equal(retryCount, nativeStatus === 500 ? 2 : 0)
        const privateState = await f.me()
        if (nativeStatus === 404) assert.deepEqual(privateState.enrollments, [])
        else assert.equal(privateState.enrollments[0]!.joinedAt, rawEpoch)
        const retained = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
        assert.equal(retained.state, nativeStatus === 404 ? "cancelled" : "blocked")
        assert.equal(retained.postNo, undefined)
        assert(!JSON.stringify(retained).includes("Synthetic opaque"))
    })
}

test("actual worker revokes a raw epoch representation change even when parsed membership instants match", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now())
    const changed = "2020-02-29T00:30:00.123456789Z"
    assert.equal(Date.parse(changed), Date.parse(rawEpoch))
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        bot.rest.respond("GET /guilds/1/members/20", { body: bot.fixtures.member({ user: bot.fixtures.user({ id: "20" }), roles: [], joined_at: changed, communication_disabled_until: null }) })
        const pass = yield* processMilestonesPass(f.store, f.publishing, "1", bot.client)
        assert.equal(pass.considered, 1)
        assert(!bot.requests().some((request: { method: string }) => request.method === "POST"))
    }))
    assert.deepEqual((await f.me()).enrollments, [])
    assert.equal((await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!.reason, "membership")
})

test("fresh SDK DM identity and typed membership enter actual enrollment and removal adapters without a roster read", async t => {
    const f = await fixture(t); await f.configure()
    await withNative(f, ({ Effect, Exit }, bot) => Effect.gen(function* () {
        const verified = yield* verifyMilestonePrivateAuthor(bot.client, "600", "20")
        assert.equal(verified.botId, "999")
        const native = yield* readMilestoneMembership(bot.client, "1", "20")
        assert.equal(native.status, "present")
        const enrolled = yield* f.store.personal(f.personalInput({ type: "enroll", kind: "birthday", monthDay: "01-02", confirmChannelId: "30", participant: { ...f.participant(), member: { ...native.member, canView: true, canReadHistory: true } } }))
        assert.equal(enrollmentResult(enrolled).joinedAt, rawEpoch)
        bot.rest.respond("GET /guilds/1/members/20", { status: 404, body: { message: "Synthetic departed account" } })
        const before = bot.requests().length
        yield* verifyMilestonePrivateAuthor(bot.client, "600", "20")
        const me = yield* f.store.personal(f.personalInput({ type: "me" }))
        assert(!me.duplicate && me.type === "me" && me.enrollments.length === 1)
        const removed = yield* f.store.personal(f.personalInput({ type: "remove", kind: "all" }))
        assert(!removed.duplicate && removed.type === "removed" && removed.removed === 1)
        assert(!bot.requests().slice(before).some((request: { path: string }) => request.path.startsWith("/guilds/")))
        bot.rest.respond("GET /channels/600", { body: { id: "600", type: 1, recipients: [bot.fixtures.user({ id: "20" }), bot.fixtures.user({ id: "21" })], last_message_id: null } })
        assert(Exit.isFailure(yield* Effect.exit(verifyMilestonePrivateAuthor(bot.client, "600", "20"))))
    }))
    assert.deepEqual((await f.me()).enrollments, [])
})

test("delayed actual claim response reaches final native expiry check with no provider send or automatic replay", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now())
    await withNative(f, ({ Effect, Deferred, Fiber, TestClock }, bot) => Effect.gen(function* () {
        const entered = yield* Deferred.make(), release = yield* Deferred.make()
        const actual = createPublishingStore(f.config)
        const delayed = { ...actual, dispatch: (input: PublishingDispatchRequest) => actual.dispatch(input).pipe(Effect.flatMap((claim: PublishingDispatchResult) =>
            Deferred.succeed(entered, claim).pipe(Effect.andThen(Deferred.await(release)), Effect.as(claim)))) }
        const send = bot.rest.respond("POST /channels/30/messages", { status: 500, body: { message: "Synthetic forbidden expired send" } })
        const running = yield* Effect.forkChild(processMilestonesPass(f.store, delayed, "1", bot.client))
        const claim = yield* Deferred.await(entered)
        assert(claim.claimed)
        const elapsed = claim.dispatchExpiresAt - f.now()
        f.advance(elapsed); yield* TestClock.adjust(`${elapsed} millis`)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(running)
        assert.equal(send.requests().length, 0)
    }))
    const retained = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
    assert.equal(retained.claimedAt, row.dueAt)
    assert(retained.postNo)
    const post = await f.post(retained.postNo)
    assert.notEqual(post.outcome, "sent")
    assert.equal(post.attempt.noDispatch, undefined, "Claimed work cannot be misclassified as proof of no dispatch")
})

test("fair milestone discovery continues past twenty denied participants within the published bounded cursor", async t => {
    const f = await fixture(t); await f.configure(); await f.enable()
    for (let index = 0; index < 21; index++) await f.enroll("birthday", "01-02", String(200 + index))
    f.advance(Date.parse("2026-01-02T09:00Z") - f.now())
    const first = await f.delivery({ type: "list" })
    assert.equal(first.type, "deliveries")
    assert.equal(first.deliveries.length, 20)
    assert.equal(first.hasMore, true)
    assert(first.nextCursor)
    for (const row of first.deliveries) {
        const current: Types.DeepMutable<MilestonesDeliveryContext> = f.workerContext(row)
        current.participant.member.canView = false
        assert.deepEqual(await f.delivery({ type: "reserve", binding: binding(row), context: current }), { type: "reservation", status: "waiting" })
    }
    const second = await f.delivery({ type: "list", cursor: first.nextCursor })
    assert.equal(second.type, "deliveries")
    assert(second.deliveries.length > 0 && second.deliveries.length <= 20)
    const available = second.deliveries.find(row => !first.deliveries.some(prior => prior.deliveryId === row.deliveryId))
    assert(available, "Durable continuation must reach the sibling beyond a denied discovery page")
    await f.sent(available)
    for (const row of first.deliveries) {
        const denied = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
        assert.equal(denied.state, "blocked")
        assert.equal(denied.postNo, undefined)
    }
})

test("thirty-day milestone cleanup retires settled owned tracking but preserves unknown audit and 400-day annual fences", async t => {
    const f = await fixture(t); await f.open(); await f.enroll("birthday", "01-02", "21")
    const rows = await f.deliveries(), settledRow = rows.find(value => value.userId === "20" && value.state === "queued")!, unknownRow = rows.find(value => value.userId === "21" && value.state === "queued")!
    f.advance(settledRow.dueAt - f.now()); const settled = await f.sent(settledRow), unknown = await f.reserve(unknownRow)
    assert((await f.dispatch(unknown, unknownRow)).claimed)
    assert.deepEqual(await f.outcome(unknown, "uncertain"), { recorded: true })
    await f.personal({ type: "remove", kind: "all" }); await f.personal({ type: "remove", kind: "all" }, "21")
    const audit = await f.post(unknown.postNo)
    f.advance(30 * 86400000 - 1); await f.cleanup()
    assert.equal((await f.post(settled.postNo)).outcome, "sent")
    f.advance(1); await f.cleanup()
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: settled.postNo } }), PublishingStoreError, 404)
    assert.deepEqual(await f.post(unknown.postNo), audit)
    const status = await f.status()
    assert.equal(status.enrollments, 0)
    assert.equal(status.deliveries, 1)
    const fences = await f.backend.run(ctx => ctx.db.query("milestoneConsumed").collect())
    assert.equal(fences.length, 2)
    assert(fences.every(value => value.expiresAt > f.now()))
    assert(!JSON.stringify(fences).includes("monthDay"))
    assert(!f.calls.some(call => /search|adopt|delete/.test(call.path)))
})

test("other administrators edit the route without changing who delivers or existing consent", async t => {
    const f = await fixture(t); const first = await f.open()
    const updated = routeResult(await f.manage({ type: "configure", kind: "birthday", expectedRevision: first.revision, channelId: first.channelId, zone: first.zone, time: "10:00", fold: first.fold, template: first.template }, f.context(admin)))
    assert.equal(updated.createdBy, owner.userId)
    assert.equal(updated.time, "10:00")
    assert.equal((await f.me()).enrollments[0]!.needsReconsent, false)
})

for (const observation of ["absent", "different-epoch"] as const) {
    test(`indexed member targets revoke ${observation} before due work and stale observations preserve re-enrollment`, async t => {
        const f = await fixture(t); await f.configure(); await f.enroll()
        const page = await f.delivery({ type: "member-targets", userId: "20" })
        assert.equal(page.type, "member-targets")
        assert.equal(page.targets.length, 1)
        assert.equal(page.hasMore, false)
        const old = page.targets[0]!
        assert.equal(old.joinedAt, rawEpoch)
        assert(!("monthDay" in old))
        assert.equal((await f.delivery({ type: "list" })).type, "deliveries")
        await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
            const hint = yield* observeMilestoneDeparture(f.store, "1", bot.client, "20")
            assert.equal(hint.considered, 0, "Departure gateway hint alone cannot revoke a current same-epoch member")
            if (observation === "absent") bot.rest.respond("GET /guilds/1/members/20", { status: 404, body: { message: "Synthetic typed absence" } })
            else bot.rest.respond("GET /guilds/1/members/20", { body: bot.fixtures.member({ user: bot.fixtures.user({ id: "20" }), roles: [], joined_at: "2020-02-29T00:30:00.123456789Z", communication_disabled_until: null }) })
            const departed = yield* observeMilestoneDeparture(f.store, "1", bot.client, "20")
            assert.equal(departed.considered, 1)
            assert.equal(departed.hasMore, false)
            assert(!bot.requests().some((request: { path: string }) => request.path === "/guilds/1/members"))
        }))
        assert.deepEqual((await f.me()).enrollments, [])
        const enrolled = await f.enroll()
        assert(enrolled.revision > old.consentRevision)
        const stale = await f.delivery({ type: "member-observation", target: old, observation: { status: "absent", userId: "20", observedAt: f.now() } })
        assert.deepEqual(stale, { type: "progress", recorded: false, hasMore: false })
        assert.deepEqual((await f.me()).enrollments, [enrolled])
        await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
            const lateHint = yield* observeMilestoneDeparture(f.store, "1", bot.client, "20")
            assert.equal(lateHint.considered, 0, "Fresh read of current re-enrollment must neutralize stale departure hints")
        }))
        assert.deepEqual((await f.me()).enrollments, [enrolled])
    })
}

test("departure opaque native403 defers and preserves both route enrollments without a fabricated delivery binding", async t => {
    const f = await fixture(t); await f.configure(); await f.configure("anniversary"); await f.enroll(); await f.enroll("anniversary")
    const before = (await f.me()).enrollments
    await withNative(f, ({ Effect, Exit }, bot) => Effect.gen(function* () {
        bot.rest.respond("GET /guilds/1/members/20", { status: 403, body: { message: "Synthetic inaccessible member" } })
        const exited = yield* Effect.exit(observeMilestoneDeparture(f.store, "1", bot.client, "20"))
        assert(Exit.isFailure(exited))
        assert(!f.calls.some(call => call.path === "/publishing/dispatch"))
    }))
    assert.deepEqual((await f.me()).enrollments, before)
    const page = await f.delivery({ type: "member-targets", userId: "20" })
    assert.equal(page.type, "member-targets")
    assert.equal(page.targets.length, 2)
    assert(page.targets.every(value => value.joinedAt === rawEpoch))
})

test("actual private command handlers let a departed DM account inspect and withdraw without guild or delivery-owner reads", async t => {
    const f = await fixture(t); await f.open()
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = bot.fixtures
        bot.rest.respond("GET /guilds/1/members/20", { status: 404, body: { message: "Synthetic departed member" } })
        bot.rest.respond("GET /guilds/1/members/10", { status: 403, body: { message: "Synthetic unavailable delivery owner" } })
        const replies = bot.rest.respond("POST /channels/600/messages", (request: { body: { content: string, embeds?: { fields?: object[] }[] } }) => {
            const result = native.message({ id: native.nextId(), channel_id: "600", author: native.botUser({ id: "999" }), content: request.body.content ?? "", embeds: request.body.embeds?.map(embed => ({ type: "rich", ...embed, fields: embed.fields?.map(field => ({ ...field, inline: false })) ?? [] })) ?? [] }); delete result.guild_id
            return { body: result }
        })
        const invoke = (args: string[]) => Effect.gen(function* () {
            const source = f.source(), raw = native.message({ id: source.messageId, channel_id: "600", author: native.user({ id: "20" }), timestamp: new Date(f.now()).toISOString(), content: `!milestone ${args.join(" ")}` }); delete raw.guild_id
            bot.rest.respond(`GET /channels/600/messages/${source.messageId}`, { body: raw })
            const message = yield* bot.client.messages.fetch({ channelId: "600", id: source.messageId })
            assert.equal(message.guildId, undefined)
            const event = { client: bot.client, message, event: message, reply: () => Effect.die("All milestone replies must use its verified private destination") } as Parameters<typeof handleMilestoneCommand>[4]
            yield* handleMilestoneCommand(f.store, f.publishing, { token: Redacted.make("synthetic-milestone-command-token"), serverId: "1" }, parseMilestoneCommand(args), event)
        })
        const before = bot.requests().length
        yield* invoke(["me"]); yield* invoke(["remove", "birthday"])
        assert(!bot.requests().slice(before).some((request: { path: string }) => request.path.startsWith("/guilds/")))
        assert.equal(replies.requests().length, 2)
        const text = JSON.stringify(replies.requests().map((request: { body: unknown }) => request.body))
        assert.match(text, /on 01-02 \(month and day\)/)
        assert.match(text, /Removed 1 of your milestone sign-ups/)
        assert.match(text, /Past celebration posts and these DMs stay/)
        assert.match(text, /400 days/)
        assert(replies.requests().every((request: { body: { allowed_mentions: unknown } }) => JSON.stringify(request.body.allowed_mentions) === JSON.stringify({ parse: [], users: [], roles: [], replied_user: false })))
    }))
    assert.deepEqual((await f.me()).enrollments, [])
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("milestoneEnrollments").collect()), [])
})

test("actual staff status replies privately and a guild personal command cannot enroll the invoking account", async t => {
    const f = await fixture(t); await f.configure()
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = bot.fixtures, dm = { id: "601", type: 1, recipients: [native.user({ id: "10" })], last_message_id: null }
        bot.rest.respond("POST /users/@me/channels", { body: dm })
        bot.rest.respond("GET /channels/601", { body: dm })
        const replies = bot.rest.respond("POST /channels/601/messages", (request: { body: { content: string, embeds?: { fields?: object[] }[] } }) => {
            const raw = native.message({ channel_id: "601", author: native.botUser({ id: "999" }), content: request.body.content ?? "", embeds: request.body.embeds?.map(embed => ({ type: "rich", ...embed, fields: embed.fields?.map(field => ({ ...field, inline: false })) ?? [] })) ?? [] }); delete raw.guild_id
            return { body: raw }
        })
        const publicReplies = bot.rest.respond("POST /channels/30/messages", { status: 500, body: { message: "Synthetic forbidden public reply" } })
        const invoke = (args: string[]) => Effect.gen(function* () {
            const source = f.source()
            bot.rest.respond(`GET /channels/30/messages/${source.messageId}`, { body: native.message({ id: source.messageId, guild_id: "1", channel_id: "30", author: native.user({ id: "10" }), timestamp: new Date(f.now()).toISOString(), content: `!milestone ${args.join(" ")}` }) })
            const message = yield* bot.client.messages.fetch({ channelId: "30", id: source.messageId })
            yield* handleMilestoneCommand(f.store, f.publishing, { token: Redacted.make("synthetic-milestone-staff-token"), serverId: "1" }, parseMilestoneCommand(args), { client: bot.client, message } as Parameters<typeof handleMilestoneCommand>[4])
        })
        yield* invoke(["status"])
        const before = f.calls.length
        yield* invoke(["birthday", "set", "01-02", "confirm", "30"])
        assert.equal(f.calls.length, before, "A guild personal command must explain private consent without calling enrollment")
        assert.equal(publicReplies.requests().length, 0)
        assert.equal(replies.requests().length, 2, JSON.stringify(replies.requests().map((request: { body: unknown }) => request.body)))
        // Staff status is a private card, and the personal command sent in the server only explains where to send it
        assert.deepEqual((replies.requests()[0]!.body as unknown as { embeds: { fields: { name: string, value: string }[] }[] }).embeds[0]!.fields.find(field => field.name === "Members signed up"), { name: "Members signed up", value: "0" })
        assert.match(replies.requests()[1]!.body.content, /Send your milestone commands here in this DM/)
    }))
    assert.deepEqual((await f.me("10")).enrollments, [])
})

test("actual exact-post forgetting confirmation removes one settled milestone and preserves unknown sibling ownership", async t => {
    const f = await fixture(t); await f.open(); await f.enroll("birthday", "01-02", "21")
    const rows = await f.deliveries(), settledRow = rows.find(value => value.userId === "20" && value.state === "queued")!, unknownRow = rows.find(value => value.userId === "21" && value.state === "queued")!
    f.advance(settledRow.dueAt - f.now()); const settled = await f.sent(settledRow), unknown = await f.reserve(unknownRow)
    assert((await f.dispatch(unknown, unknownRow)).claimed)
    assert.deepEqual(await f.outcome(unknown, "uncertain"), { recorded: true })
    const audit = await f.post(unknown.postNo)
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = bot.fixtures, dm = { id: "601", type: 1, recipients: [native.user({ id: "10" })], last_message_id: null }
        bot.rest.respond("GET /channels/601", { body: dm })
        const replies = bot.rest.respond("POST /channels/601/messages", (request: { body: { content: string, embeds?: { fields?: object[] }[] } }) => {
            const raw = native.message({ channel_id: "601", author: native.botUser({ id: "999" }), content: request.body.content ?? "", embeds: request.body.embeds?.map(embed => ({ type: "rich", ...embed, fields: embed.fields?.map(field => ({ ...field, inline: false })) ?? [] })) ?? [] }); delete raw.guild_id
            return { body: raw }
        })
        const invoke = (args: string[]) => Effect.gen(function* () {
            const source = f.source(), raw = native.message({ id: source.messageId, channel_id: "601", author: native.user({ id: "10" }), timestamp: new Date(f.now()).toISOString(), content: `!milestone ${args.join(" ")}` }); delete raw.guild_id
            bot.rest.respond(`GET /channels/601/messages/${source.messageId}`, { body: raw })
            const message = yield* bot.client.messages.fetch({ channelId: "601", id: source.messageId })
            yield* handleMilestoneCommand(f.store, f.publishing, { token: Redacted.make("synthetic-milestone-recovery-token"), serverId: "1" }, parseMilestoneCommand(args), { client: bot.client, message } as Parameters<typeof handleMilestoneCommand>[4])
        })
        const before = f.calls.filter(call => call.path === "/milestones/manage").length
        yield* invoke(["forget", "birthday", String(settled.postNo)])
        assert.equal(f.calls.filter(call => call.path === "/milestones/manage").length, before)
        const confirmation = /Confirm: `(!milestone forget birthday \d+ confirm)`/.exec(replies.requests()[0]!.body.content)?.[1]
        assert.equal(confirmation, `!milestone forget birthday ${settled.postNo} confirm`)
        yield* invoke(confirmation!.slice("!milestone ".length).split(" "))
        assert.equal(replies.requests()[1]!.body.content, "Forgot 1 post record. Posted messages stay")
        yield* invoke(["reconcile", "birthday", String(unknown.postNo)])
        assert.equal(replies.requests()[2]!.body.content, `NeonFlux does not know which message post #${unknown.postNo} is, so it cannot check it. Nothing was sent again`)
        assert(!bot.requests().some((request: { method: string, path: string }) => request.method === "PATCH" || request.method === "DELETE" || request.path.startsWith("/channels/30/messages")))
    }))
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: settled.postNo } }), PublishingStoreError, 404)
    assert.deepEqual(await f.post(unknown.postNo), audit)
    assert((await f.deliveries()).some(value => value.deliveryId === unknownRow.deliveryId && value.state === "uncertain"))
    assert(!(await f.deliveries()).some(value => value.deliveryId === settledRow.deliveryId))
})

test("actual native failed send retains uncertainty and cannot be automatically replayed after restart discovery", async t => {
    const f = await fixture(t); await f.open()
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now())
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const send = bot.rest.respond("POST /channels/30/messages", { status: 500, body: { message: "Synthetic opaque provider write result" } })
        const first = yield* processMilestonesPass(f.store, f.publishing, "1", bot.client)
        assert.equal(first.considered, 1)
        assert.equal(send.requests().length, 1, "Provider write must never retry automatically")
        const restarted = yield* processMilestonesPass(createMilestonesStore(f.config), createPublishingStore(f.config), "1", bot.client)
        assert.equal(restarted.considered, 0)
        assert.equal(send.requests().length, 1)
    }))
    const delivery = (await f.deliveries()).find(value => value.deliveryId === row.deliveryId)!
    assert(delivery.postNo)
    assert.equal(delivery.state, "uncertain")
    const post = await f.post(delivery.postNo)
    assert.equal(post.attempt.outcome, "uncertain")
    assert.equal(post.messageId, undefined)
    assert.equal(post.attempt.noDispatch, undefined)
    assert(!JSON.stringify(post).includes("Synthetic opaque provider"))
})

test("birthday payload and replay receipts omit date while publisher grants keep complete ownership bindings", async t => {
    const f = await fixture(t); const route = await f.open("birthday", "01-02")
    const row = (await f.deliveries()).find(value => value.state === "queued")!
    f.advance(row.dueAt - f.now())
    const grant = await f.reserve(row)
    assert.deepEqual(grant.source, { type: "milestone-timer", deliveryId: row.deliveryId, dueAt: row.dueAt })
    assert.deepEqual(grant.consumer, { type: "milestone", ...binding(row) })
    assert.deepEqual(grant.provenance, { type: "milestone", kind: "birthday", intentRevision: row.intentRevision, template: route.template })
    assert.equal(grant.actorId, grant.botId)
    assert.equal(grant.dispatchExpiresAt, f.now() + 180000)
    assert.equal(grant.nativeDeadlineMs, 5000)
    assert.match(grant.content.content ?? "", /\\\*member\\\*/)
    assert.match(grant.content.content ?? "", /\\@everyone/)
    assert(!JSON.stringify(grant.content).includes("01-02"))
    assert(!JSON.stringify(row).includes("monthDay"))
    const retained = await f.backend.run(async ctx => ({ receipts: await ctx.db.query("milestoneReceipts").collect(), deliveries: await ctx.db.query("milestoneDeliveries").collect() }))
    assert(!JSON.stringify(retained).includes('"monthDay"'))
    assert(!JSON.stringify(retained.receipts).includes("01-02"))
    for (const operation of [
        { type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation },
        { type: "edit", postNo: grant.postNo, expectedGeneration: grant.generation, kind: "template", name: route.template.name, expectedRevision: route.template.revision, context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } },
    ] satisfies PublishingManageOperation[]) await f.reject(f.publishing.manage({ ...f.source(), actor: owner, operation }), PublishingStoreError, 409)
})
