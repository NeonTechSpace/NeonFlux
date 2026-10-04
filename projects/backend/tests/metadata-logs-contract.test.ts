import assert from "node:assert/strict"
import nodeTest, { after, type TestContext } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { makeFunctionReference } from "convex/server"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const proofCalls = { http: 0, sdkReads: 0, sdkSends: 0, gatewayCounts: 0 }
after(t => t.diagnostic(`Metadata contract call totals ${JSON.stringify(proofCalls)}, zero real network or provider writes`))
const routes = ["/metadata-logs/admit", "/metadata-logs/manage", "/metadata-logs/query", "/metadata-logs/work"]
const lifecycle = { grantMs: 120000, settleMs: 10000 }
const modules = {
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/metadataLogsRetention.ts": () => import("../convex/metadataLogsRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
}
const joinedAt = "2020-02-29T00:30:00.123456789+00:00"
const owner: C.ModerationActor = { userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const binding = ({ recordNo, routeRevision, moduleRevision, generation, channelId, ownerId, routeEventType }: C.MetadataLogsBinding): C.MetadataLogsBinding => ({ recordNo, routeRevision, moduleRevision, generation, channelId, ownerId, ...(routeEventType ? { routeEventType } : {}) })

async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    t.after(() => { proofCalls.http += f.calls.length })
    const { createMetadataLogsStore, MetadataLogsStoreError } = await import("../../bot/src/metadata-log-store.ts")
    const store = createMetadataLogsStore(f.config), wrongStore = createMetadataLogsStore(f.wrongConfig)
    let sequence = 0
    const member = (userId: string, isBot = false): C.EventsMemberContext => ({ userId, joinedAt, roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
    const context = (channelId = "30", actor = owner): C.MetadataLogsContext => ({ observedAt: f.now(), actor, member: member(actor.userId), channelId, channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot", botMember: member("999", true) })
    const privateRead: C.MetadataLogsPrivateRead = { channelId: "90", recipientIds: ["10", "999"], oneToOne: true }
    const manageInput = (operation: C.MetadataLogsManageOperation, current = context()): C.MetadataLogsManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.MetadataLogsManageOperation, current = context()) => f.run<C.MetadataLogsManageResult>(store.manage(manageInput(operation, current)))
    const queryInput = (operation: C.MetadataLogsQueryOperation, current = context(), privateProof = privateRead): C.MetadataLogsQueryRequest => ({ serverId: "1", context: current, privateRead: privateProof, operation })
    const query = (operation: C.MetadataLogsQueryOperation, current = context()) => f.run<C.MetadataLogsQueryResult>(store.query(queryInput(operation, current)))
    const settings = async () => { const result = await query({ type: "settings" }); assert.equal(result.type, "settings"); return result.settings }
    const counters = async () => { const result = await query({ type: "counters" }); assert.equal(result.type, "counters"); return result.counters }
    const show = async (recordNo: number) => { const result = await query({ type: "show", recordNo }); assert.equal(result.type, "record"); return result.record }
    const list = async (beforeRecordNo?: number) => { const result = await query({ type: "list", ...(beforeRecordNo ? { beforeRecordNo } : {}) }); assert.equal(result.type, "records"); return result }
    const route = async (category: C.MetadataLogsCategory = "membership", channelId = "30", enabled = true, ownerId = "10") => {
        const current = (await settings()).routes.find(r => r.category === category)!
        return manage({ type: "route", category, expectedRevision: current.revision, channelId, ownerId, enabled, recipientOwner: context(channelId, { ...owner, userId: ownerId }) })
    }
    const module = async (enabled: boolean) => manage({ type: "module", expectedRevision: (await settings()).revision, enabled })
    const open = async (category: C.MetadataLogsCategory = "membership", channelId = "30") => { await route(category, channelId); await module(true) }
    const event = (extra: Partial<C.MetadataLogsEvent> = {}): C.MetadataLogsEvent => ({ category: "membership", type: "member-update", source: { kind: "observation", sessionId: "1".repeat(32), sequence: ++sequence }, observedAt: f.now(), actor: { kind: "unknown" }, resourceIds: ["20"], changedFields: ["roles"], count: 1, ...extra })
    const admit = (current = event()) => f.run<C.MetadataLogsAdmitResult>(store.admit({ serverId: "1", event: current }))
    const admitted = async (current = event()) => { const result = await admit(current); assert.equal(result.admitted, true); return result.record }
    const work = (operation: C.MetadataLogsWorkOperation) => f.run<C.MetadataLogsWorkResult>(store.work({ serverId: "1", operation }))
    const discover = async (cursor?: string) => { const result = await work({ type: "discover", ...(cursor ? { cursor } : {}) }); assert.equal(result.type, "work"); return result }
    const reserve = async (record: C.MetadataLogsRecord) => { assert(record.delivery); const result = await work({ type: "reserve", binding: binding(record.delivery), context: context(record.delivery.channelId, { ...owner, userId: record.delivery.ownerId }) }); assert.equal(result.type, "reserved"); return result.grant }
    const claim = async (grant: C.MetadataLogsGrant, claimToken = "a".repeat(32)) => { const result = await work({ type: "claim", binding: binding(grant), context: context(grant.channelId, { ...owner, userId: grant.ownerId }), claimToken }); assert.equal(result.type, "claimed"); return result }
    const outcome = (grant: C.MetadataLogsGrant, outcome: "sent" | "failed" | "uncertain", messageId?: string, claimToken = "a".repeat(32)) => work({ type: "outcome", binding: binding(grant), claimToken, outcome, observedAt: f.now(), ...(messageId ? { messageId } : {}) })
    const post = (path: string, body: unknown) => f.backend.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-adapter-secret-not-a-credential-0000" }, body: JSON.stringify(body) })
    const cleanup = () => f.backend.mutation(makeFunctionReference<"mutation">("metadataLogsRetention:cleanup"), {})
    return { ...f, store, wrongStore, MetadataLogsStoreError, context, privateRead, manageInput, manage, queryInput, query, settings, counters, show, list, route, module, open, event, admit, admitted, work, discover, reserve, claim, outcome, post, cleanup }
}

async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Clock, Effect, Exit, Fiber, Deferred, Random, Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions, commands } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot, createFixtures } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Clock, Effect, Exit, Fiber, Deferred, Random, Redacted, TestClock, Permissions, commands, createTestBot, createFixtures }
}

async function withNative(f: Awaited<ReturnType<typeof adapterFixture>>, body: (runtime: Awaited<ReturnType<typeof sdk>>, bot: any) => any, onCount?: () => void) {
    const runtime = await sdk(), { Clock, Effect, Random, TestClock, Permissions, createTestBot, createFixtures } = runtime
    return f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const clock = yield* Clock.Clock, origin = clock.monotonicTimeNanosUnsafe()
        const monotonicTimeNanosUnsafe = () => clock.monotonicTimeNanosUnsafe() - origin
        const sdkClock = { ...clock, monotonicTimeNanosUnsafe, monotonicTimeNanos: Effect.sync(monotonicTimeNanosUnsafe) }
        const bot = yield* createTestBot({ token: "synthetic-metadata-sdk-token", user: createFixtures().botUser({ id: "999" }), ...(onCount ? { logging: { level: "trace", dedupe: false, sink: (record: { code: string, fields?: { opcode?: number } }) => { if (record.code === "gateway.send" && record.fields?.opcode === 15) onCount() } } } : {}) }).pipe(Effect.provideService(Clock.Clock, sdkClock)), native = bot.fixtures
        const everyone = native.role({ id: "1", permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory).toString() })
        const adminRole = native.role({ id: "50", permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ id: "51", permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks | Permissions.ReadMessageHistory | Permissions.ViewAuditLog).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /users/999", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10", name: "Synthetic metadata server" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [everyone, adminRole, botRole] })
        for (const userId of ["10", "11"]) {
            const user = native.user({ id: userId, bot: false, system: false })
            bot.rest.respond(`GET /users/${userId}`, { body: user })
            bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user, roles: ["50"], joined_at: joinedAt, communication_disabled_until: null }) })
        }
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: ["51"], joined_at: joinedAt, communication_disabled_until: null }) })
        for (const id of ["30", "31", "32", "35"]) bot.rest.respond(`GET /channels/${id}`, { body: native.channel({ id, guild_id: "1", type: 0 }) })
        yield* body(runtime, bot).pipe(Effect.ensuring(Effect.sync(() => {
            const calls = bot.requests() as { method: string, path: string, matched: boolean }[]
            assert(calls.every(call => call.matched), JSON.stringify(calls.filter(call => !call.matched).map(({ method, path }) => ({ method, path }))))
            assert(!calls.some(call => ["DELETE", "PATCH", "PUT"].includes(call.method)), "Metadata logs never mutate existing native resources")
            proofCalls.sdkReads += calls.filter(call => call.method === "GET").length
            proofCalls.sdkSends += calls.filter(call => call.method === "POST" && /\/channels\/\d+\/messages$/.test(call.path)).length
            proofCalls.gatewayCounts += bot.commands().filter((command: { op: number }) => command.op === 15).length
        })))
    })).pipe(Random.withSeed("synthetic-metadata-sdk"), Effect.provide(TestClock.layer())))
}

function barrier() {
    let enter!: () => void, release!: () => void, reject!: (error: Error) => void, reached = false
    const entered = new Promise<void>((resolve, fail) => { enter = resolve; reject = fail })
    const released = new Promise<void>(resolve => { release = resolve })
    return { entered, release, wait: async () => { reached = true; enter(); await released }, finish: () => { if (!reached) reject(new Error("Worker finished before the requested actual boundary")) } }
}

function advanceNative(f: Awaited<ReturnType<typeof adapterFixture>>, runtime: Awaited<ReturnType<typeof sdk>>, milliseconds: number) {
    return runtime.Effect.sync(() => f.advance(milliseconds)).pipe(runtime.Effect.andThen(runtime.TestClock.adjust(`${milliseconds} millis`)))
}

function nativeSend(bot: any, options: { failure?: boolean, conflict?: boolean } = {}) {
    const content = new Map<string, string>()
    const embeds = new Map<string, unknown[]>()
    let next = 9000
    const send = bot.rest.respond("POST /channels/:channel/messages", (request: { path: string, body: Record<string, unknown> }) => {
        assert.deepEqual(request.body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(typeof request.body.content, "string")
        if (options.failure) return { status: 403, body: { code: 50013, message: "Synthetic private provider failure" } }
        const messageId = String(++next), channelId = request.path.split("/")[2]!
        content.set(messageId, String(request.body.content))
        embeds.set(messageId, Array.isArray(request.body.embeds) ? request.body.embeds.map(embed => ({ type: "rich", ...embed })) : [])
        return { body: bot.fixtures.message({ id: messageId, channel_id: channelId, guild_id: "1", author: bot.fixtures.botUser({ id: "999" }), content: request.body.content, embeds: embeds.get(messageId), attachments: [] }) }
    })
    const exact = bot.rest.respond("GET /channels/:channel/messages/:message", (request: { path: string }) => {
        const messageId = request.path.split("/")[4]!, channelId = request.path.split("/")[2]!
        assert(content.has(messageId), "Only a response-proven exact message ID may be observed")
        return { body: bot.fixtures.message({ id: messageId, channel_id: channelId, guild_id: "1", author: bot.fixtures.botUser({ id: "999" }), content: options.conflict ? "Synthetic foreign current text" : content.get(messageId), embeds: embeds.get(messageId), attachments: [] }) }
    })
    return { content, send, exact }
}

test("metadata authenticates every real adapter route and starts disabled without changing moderation logs", async t => {
    const f = await fixture(t), settings = await f.settings()
    assert.equal(settings.enabled, false); assert.equal(settings.retained, 0); assert.equal(settings.capacity, 10000)
    assert.equal(settings.routes.length, 6); assert(settings.routes.every(route => !route.enabled && !route.channelId && !route.ownerId))
    for (const effect of [f.wrongStore.manage(f.manageInput({ type: "module", expectedRevision: settings.revision, enabled: true })), f.wrongStore.query(f.queryInput({ type: "settings" })), f.wrongStore.admit({ serverId: "1", event: f.event() }), f.wrongStore.work({ serverId: "1", operation: { type: "discover" } })]) await f.reject(effect, f.MetadataLogsStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), f.MetadataLogsStoreError, 403)
    assert.deepEqual(await f.admit(), { admitted: false, duplicate: false, reason: "disabled" })
    assert.deepEqual((await f.discover()).records, [])
    const { createModerationStore } = await import("../../bot/src/moderation-store.ts")
    const moderation = createModerationStore(f.config)
    const original = await f.run<C.ModerationQueryResult>(moderation.query({ serverId: "1", actor: owner, operation: { type: "settings" } }))
    await f.open(); const current = await f.run<C.ModerationQueryResult>(moderation.query({ serverId: "1", actor: owner, operation: { type: "settings" } }))
    assert.deepEqual(current, original)
    assert.deepEqual(new Set(f.calls.filter(c => c.status === 401).map(c => c.path)), new Set(routes))
})

const forbidden = ["content", "body", "attachments", "contentHash", "reason", "ticket", "appeal", "birthday", "inviteCode", "verificationLink", "token", "changes", "rawError", "stack"]
test("actual ingress rejects every forbidden field and unproven actor before persistence", async t => {
    const f = await fixture(t); await f.open()
    const before = await f.counters()
    for (const field of forbidden) {
        const response = await f.post("/metadata-logs/admit", { serverId: "1", event: { ...f.event(), [field]: "Synthetic private payload must not persist" } })
        assert.equal(response.status, 400, field); assert(!JSON.stringify(await response.json()).includes("Synthetic private payload"))
    }
    for (const actor of [{ kind: "audit", userId: "10" }, { kind: "configuration", userId: "10" }, { kind: "unknown", userId: "10" }]) {
        assert.equal((await f.post("/metadata-logs/admit", { serverId: "1", event: f.event({ actor: actor as C.MetadataLogsActor }) })).status, 400)
    }
    assert.deepEqual(await f.counters(), before)
    const record = await f.admitted(); assert.deepEqual(record.event.actor, { kind: "unknown" })
    assert(!JSON.stringify(record).includes("Synthetic private payload"))
})

test("audit attribution remains on its exact source entry and cannot attach to nearby observations", async t => {
    const f = await fixture(t); await f.open(); await f.route("audit")
    const audit = f.event({ category: "audit", type: "audit-entry", source: { kind: "audit", auditEntryId: "2000" }, actor: { kind: "audit", userId: "11" }, resourceIds: ["20"], changedFields: [], auditAction: 22 })
    const recorded = await f.admitted(audit), nearby = await f.admitted()
    assert.deepEqual(recorded.event.actor, { kind: "audit", userId: "11" }); assert.deepEqual(nearby.event.actor, { kind: "unknown" })
    assert.deepEqual(await f.admit({ ...audit, observedAt: f.now() + 1 }), { admitted: false, duplicate: true, reason: "duplicate" })
    for (const changed of [{ auditAction: 40 }, { resourceIds: ["SyntheticInviteCode"] }, { resourceIds: [] }, { source: { kind: "observation", sessionId: "1".repeat(32), sequence: 20 } }])
        assert.equal((await f.post("/metadata-logs/admit", { serverId: "1", event: { ...audit, ...changed } })).status, 400)
    assert.equal((await f.show(nearby.recordNo)).event.actor.kind, "unknown")
})

test("stable deletion and raw membership source dedupe differs from session observation retries", async t => {
    const f = await fixture(t); await f.open(); await f.route("messages")
    await f.manage({ type: "channels", expectedRevision: (await f.settings()).revision, messageChannelIds: ["31"], excludedChannelIds: [] })
    const deletion = f.event({ category: "messages", type: "message-delete", source: { kind: "message-delete", messageId: "5000" }, resourceIds: ["5000"], changedFields: [], channelId: "31", authorBot: null, privateChannel: false })
    await f.admitted(deletion); assert.equal((await f.admit({ ...deletion, observedAt: f.now() + 1 })).duplicate, true)
    const rawJoinedAt = new Date(f.now()).toISOString(), join = f.event({ type: "member-add", source: { kind: "member-add", userId: "20", joinedAt: rawJoinedAt }, changedFields: [] })
    await f.admitted(join); assert.equal((await f.admit(join)).duplicate, true)
    const observation = f.event(); await f.admitted(observation); assert.equal((await f.admit(observation)).duplicate, true)
    await f.admitted({ ...observation, source: { kind: "observation", sessionId: "2".repeat(32), sequence: 1 } })
    assert.equal((await f.counters()).categories.membership, 3, "A replay after session replacement is another admitted observation, not a unique action")
})

test("message opt-in excludes private channels, every log destination and bot feedback while bulk remains one bounded record", async t => {
    const f = await fixture(t); await f.open("messages")
    await f.manage({ type: "channels", expectedRevision: (await f.settings()).revision, messageChannelIds: ["30", "31", "32"], excludedChannelIds: ["32"] })
    const message = (extra: Partial<C.MetadataLogsEvent> = {}) => f.event({ category: "messages", type: "message-update", resourceIds: ["5000"], changedFields: ["update"], channelId: "31", authorBot: false, privateChannel: false, ...extra })
    for (const variation of [{ channelId: "30" }, { channelId: "32" }, { channelId: "33" }, { authorBot: true }, { privateChannel: true }]) assert.equal((await f.admit(message(variation))).admitted, false)
    const bulk = await f.admitted(message({ type: "message-bulk-delete", resourceIds: Array.from({ length: 20 }, (_, i) => String(5000 + i)), changedFields: [], count: 1000, authorBot: null }))
    assert.equal(bulk.event.count, 1000); assert.equal((await f.counters()).categories.messages, 1)
    const excessive = [message({ resourceIds: Array.from({ length: 21 }, (_, i) => String(5000 + i)) }), message({ type: "message-bulk-delete", count: 1001 }), message({ changedFields: ["content"] })]
    for (const event of excessive) assert.equal((await f.post("/metadata-logs/admit", { serverId: "1", event })).status, 400)
})

test("admitted work binds original category route while disable pauses and re-enable preserves backlog", async t => {
    const f = await fixture(t); await f.open()
    const first = await f.admitted(); assert(first.delivery); assert.equal(first.delivery.channelId, "30")
    await f.route("membership", "31"); const second = await f.admitted(); assert(second.delivery); assert.equal(second.delivery.channelId, "31")
    await f.module(false); await f.reject(f.store.work({ serverId: "1", operation: { type: "reserve", binding: binding(first.delivery), context: f.context() } }), f.MetadataLogsStoreError, 409)
    assert.equal((await f.show(first.recordNo)).delivery!.state, "queued")
    await f.module(true); const page = await f.discover(); assert(page.records.some(r => r.recordNo === first.recordNo)); assert(page.records.some(r => r.recordNo === second.recordNo))
    const original = await f.reserve(first); assert.equal(original.channelId, "30"); assert.equal(original.routeRevision, first.delivery.routeRevision)
})

test("one-time claim survives route replacement and late outcome never rewrites aged uncertainty", async t => {
    const f = await fixture(t); await f.open()
    const record = await f.admitted(), grant = await f.reserve(record)
    assert.equal((await f.claim(grant)).claimed, true); assert.equal((await f.claim(grant)).claimed, false)
    await f.route("membership", "31"); await f.module(false)
    f.advance(lifecycle.grantMs + lifecycle.settleMs + 1); await f.cleanup()
    const aged = await f.show(record.recordNo); assert.equal(aged.delivery!.state, "uncertain")
    await f.outcome(grant, "sent", "6000")
    const late = await f.show(record.recordNo)
    assert.equal(late.delivery!.state, "uncertain"); assert.equal(late.delivery!.finishedAt, aged.delivery!.finishedAt); assert.equal(late.delivery!.messageId, "6000")
    assert.equal(late.delivery!.channelId, "30"); assert.equal(late.delivery!.generation, grant.generation)
    await f.module(true); assert(!(await f.discover()).records.some(row => row.recordNo === record.recordNo))
})

test("private reports require exact one-to-one recipients and denied reads admit no records", async t => {
    const f = await fixture(t); await f.open(); const before = await f.counters()
    for (const operation of [{ type: "counters" }] as C.MetadataLogsQueryOperation[]) {
        const request = f.queryInput(operation)
        const { privateRead: omitted, ...withoutProof } = request
        assert.equal((await f.post("/metadata-logs/query", withoutProof)).status, 403)
        for (const privateRead of [{ ...f.privateRead, oneToOne: false }, { ...f.privateRead, recipientIds: ["10", "999", "20"] }, { ...f.privateRead, recipientIds: ["11", "999"] }]) {
            const status = (await f.post("/metadata-logs/query", { ...request, privateRead })).status
            assert([400, 403].includes(status), "Unverified private context must be rejected before sensitive reads")
        }
        await f.query(operation)
    }
    assert.deepEqual(await f.counters(), before)
})

test("core settings hook records actual mutator atomically and exact source replay creates no second audit", async t => {
    const f = await fixture(t); await f.open()
    const { createModerationStore } = await import("../../bot/src/moderation-store.ts")
    const moderation = createModerationStore(f.config)
    const request: C.ModerationManageRequest = { ...f.source(), actor: owner, operation: { type: "settings", patch: { logChannelId: "35", defcon: 2 } } }
    await f.run(moderation.manage(request)); const beforeReplay = await f.counters()
    assert.deepEqual(await f.run(moderation.manage(request)), { duplicate: true })
    assert.deepEqual(await f.counters(), beforeReplay)
    const records = (await f.list()).records.filter(r => r.event.category === "settings" && r.event.source.kind === "settings" && r.event.source.messageId === request.messageId)
    assert.equal(records.length, 1)
    assert.deepEqual(records[0]!.event.actor, { kind: "configuration", userId: "10" })
    assert.deepEqual(new Set(records[0]!.event.changedFields), new Set(["logChannelId", "defcon"]))
    assert.equal(records[0]!.event.outcome, "accepted"); assert(!JSON.stringify(records).includes("patch"))
    const invalid = { ...f.source(), actor: owner, operation: { type: "settings", patch: { logChannelId: "36", defcon: 0 } } }
    const rejected = await f.post("/moderation/manage", invalid); assert.equal(rejected.status, 400)
    const current = await f.run<C.ModerationQueryResult>(moderation.query({ serverId: "1", actor: owner, operation: { type: "settings" } }))
    assert.equal(current.type, "settings"); assert.equal(current.settings.logChannelId, "35"); assert.equal(current.settings.defcon, 2)
    assert.deepEqual(await f.counters(), beforeReplay)
    const forged = f.event({ category: "settings", type: "settings-change", source: { kind: "settings", messageId: "7000", scope: "moderation" }, actor: { kind: "configuration", userId: "10" }, changedFields: ["defcon"] })
    assert.equal((await f.post("/metadata-logs/admit", { serverId: "1", event: forged })).status, 400)
})

test("metadata configuration receipts bind actor operation and monotonic source order", async t => {
    const f = await fixture(t); await f.open()
    const request = f.manageInput({ type: "channels", expectedRevision: (await f.settings()).revision, messageChannelIds: ["31"], excludedChannelIds: ["32"] })
    await f.run(f.store.manage(request)); const accepted = await f.counters()
    assert.deepEqual(await f.run(f.store.manage(request)), { duplicate: true })
    await f.reject(f.store.manage({ ...request, operation: { ...request.operation, type: "channels", expectedRevision: 1, messageChannelIds: [], excludedChannelIds: [] } }), f.MetadataLogsStoreError, 409)
    await f.reject(f.store.manage({ ...request, context: f.context("30", { ...owner, userId: "11", isOwner: false, isAdministrator: true }) }), f.MetadataLogsStoreError, 409)
    await f.reject(f.store.manage({ ...f.manageInput({ type: "module", expectedRevision: (await f.settings()).revision, enabled: false }), createdAt: f.now() - 1 }), f.MetadataLogsStoreError, 409)
    assert.deepEqual(await f.counters(), accepted)
})

test("twenty-record query and indexed work continuations reach the twenty-first blocked candidate fairly", async t => {
    const f = await fixture(t); await f.open()
    const records: C.MetadataLogsRecord[] = []
    for (let i = 0; i < 21; i++) records.push(await f.admitted())
    const first = await f.list(); assert.equal(first.records.length, 20); assert(first.nextBeforeRecordNo)
    const next = await f.list(first.nextBeforeRecordNo)
    assert(next.records.every(r => r.recordNo < first.nextBeforeRecordNo!)); assert(!next.records.some(r => first.records.some(old => old.recordNo === r.recordNo)))
    assert.equal(new Set([...first.records, ...next.records].filter(r => r.event.category === "membership").map(r => r.recordNo)).size, 21)
    const work = await f.discover(); assert.equal(work.records.length, 20); assert(work.nextCursor)
    const final = await f.discover(work.nextCursor); assert.equal(final.records.length, 1); assert.equal(final.records[0]!.recordNo, records[20]!.recordNo)
    for (const record of work.records) { assert(record.delivery); await f.work({ type: "defer", binding: binding(record.delivery) }) }
    const later = await f.discover(); assert(later.records.some(r => r.recordNo === records[20]!.recordNo), "Deferral moves blocked owners out of due priority")
})

test("settled expiry and forgetting decrement retained totals while unresolved anchors retain quota", async t => {
    const f = await fixture(t); await f.open()
    const sentRecord = await f.admitted(), uncertainRecord = await f.admitted(), sentGrant = await f.reserve(sentRecord), uncertainGrant = await f.reserve(uncertainRecord)
    assert((await f.claim(sentGrant)).claimed); await f.outcome(sentGrant, "sent", "8000")
    assert((await f.claim(uncertainGrant)).claimed); await f.outcome(uncertainGrant, "uncertain")
    const before = await f.counters(); assert.equal(before.categories.membership, 2); assert.equal(before.uncertain, 1)
    await f.reject(f.store.manage(f.manageInput({ type: "forget", recordNo: uncertainRecord.recordNo, confirm: true })), f.MetadataLogsStoreError, 409)
    f.advance(2592000001); await f.cleanup()
    const after = await f.counters(); assert.equal(after.categories.membership, 1); assert.equal(after.uncertain, 1)
    assert.equal((await f.show(uncertainRecord.recordNo)).delivery!.state, "uncertain")
    assert.equal((await f.post("/metadata-logs/query", f.queryInput({ type: "show", recordNo: sentRecord.recordNo }))).status, 404)
    const fresh = await f.admitted(); const grant = await f.reserve(fresh); assert((await f.claim(grant)).claimed); await f.outcome(grant, "sent", "8001")
    await f.manage({ type: "forget", recordNo: fresh.recordNo, confirm: true })
    assert.equal((await f.counters()).categories.membership, 1)
    assert.equal((await f.settings()).admissions, 1, "Forgetting records does not remove the independent rolling admission receipt")
})

test("failure observations are rate limited and expose fixed codes without recursive admission", async t => {
    const f = await fixture(t); await f.open()
    const event = () => f.event({ category: "operations", type: "delivery-failure", resourceIds: [], changedFields: [], count: 1, outcome: "failed" })
    await f.admitted(event()); const suppressed = await f.admit(event()); assert(!suppressed.admitted); assert.equal(suppressed.reason, "rate-limited")
    f.advance(60000); await f.admitted(event()); const counters = await f.counters()
    assert.equal(counters.categories.operations, 2); assert.equal(counters.suppressed, 1)
    const hostile = { ...event(), error: { message: "Synthetic private provider error", stack: "Synthetic private stack" } }
    assert.equal((await f.post("/metadata-logs/admit", { serverId: "1", event: hostile })).status, 400)
})

test("actual gateway projection admit discovery worker SDK send claim and outcome preserve body-free metadata", async t => {
    const f = await fixture(t); await f.open()
    const { projectMetadataEvent } = await import("../../bot/src/metadata-log-projector.ts")
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    let saved: C.MetadataLogsRecord | undefined
    await withNative(f, ({ Effect, Deferred }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot), operations: string[] = []
        const admitted = yield* Deferred.make()
        yield* bot.client.on("guildMemberUpdate", (payload: unknown) => Effect.gen(function* () {
            const event = projectMetadataEvent("guildMemberUpdate", payload, { serverId: "1", sessionId: "3".repeat(32), sequence: 1, observedAt: f.now() })
            assert(event, "Actual SDK event shape projects to the frozen DTO")
            const result = yield* f.store.admit({ serverId: "1", event }); assert(result.admitted); saved = result.record
        }).pipe(Effect.tap(() => Deferred.succeed(admitted, undefined)), Effect.catchCause((cause: any) => Deferred.failCause(admitted, cause))))
        yield* bot.ready()
        yield* bot.emit("GUILD_MEMBER_UPDATE", { guild_id: "1", user: bot.fixtures.user({ id: "20", username: "SyntheticPrivateName" }), roles: [], nick: "SyntheticPrivateNickname", joined_at: joinedAt })
        yield* Deferred.await(admitted); assert(saved)
        const wrapped = { ...f.store, work: (input: C.MetadataLogsWorkRequest) => f.store.work(input).pipe(Effect.tap(() => Effect.sync(() => { operations.push(input.operation.type) }))) }
        const result = yield* processMetadataLogsPass(wrapped, "1", bot.client)
        assert.equal(result.sent, 1); assert.equal(native.send.requests().length, 1); assert.equal(native.exact.requests().length, 0)
        assert.deepEqual(operations, ["discover", "reserve", "claim", "outcome"])
        const after = yield* Effect.promise(() => f.show(saved!.recordNo))
        assert.equal(after.delivery!.state, "sent"); assert.equal(after.delivery!.messageId, "9001")
        assert.deepEqual(after.event.actor, { kind: "unknown" })
        assert(!JSON.stringify(after).includes("SyntheticPrivate")); assert(!String(native.send.requests()[0]!.body.content).includes("SyntheticPrivate"))
    }))
})

test("actual projector strips private audit values and batches while original moderation grammar keeps precedence", async t => {
    const f = await fixture(t); await f.open("messages")
    await f.manage({ type: "channels", expectedRevision: (await f.settings()).revision, messageChannelIds: ["31"], excludedChannelIds: [] })
    const { projectMetadataEvent } = await import("../../bot/src/metadata-log-projector.ts")
    const { parseMetadataLogCommand, isMetadataLogCommand } = await import("../../bot/src/metadata-log-command.ts")
    const { parseSafetyCommand } = await import("../../bot/src/moderation-command.ts")
    const scope = { serverId: "1", sessionId: "4".repeat(32), sequence: 1, observedAt: f.now(), botId: "999" }
    const bulk = projectMetadataEvent("messageDeleteBulk", { guildId: "1", channelId: "31", ids: Array.from({ length: 100 }, (_, i) => String(10000 + i)), content: "SyntheticPrivateBody", attachments: ["SyntheticPrivateURL"] }, scope)
    assert(bulk); assert.equal(bulk.resourceIds.length, 20); assert.equal(bulk.count, 100)
    const record = await f.admitted(bulk); assert(!JSON.stringify(record).includes("SyntheticPrivate"))
    await f.route("audit")
    const audit = projectMetadataEvent("guildAuditLogEntryCreate", { guildId: "1", id: "14000", targetId: "20", userId: "11", actionType: 22, reason: "SyntheticPrivateReason", changes: [{ key: "nick", oldValue: "SyntheticPrivateOld", newValue: "SyntheticPrivateNew" }] }, scope)
    assert(audit); assert.deepEqual(audit.actor, { kind: "audit", userId: "11" })
    assert(!JSON.stringify(await f.admitted(audit)).includes("SyntheticPrivate"))
    const removal = projectMetadataEvent("guildMemberRemove", { guildId: "1", userId: "20", actorId: "11", reason: "SyntheticPrivateReason" }, scope)
    assert(removal); assert.deepEqual(removal.actor, { kind: "unknown" }); assert.equal(removal.type, "member-remove")
    for (const payload of [{ guildId: "2", channelId: "31", id: "12000" }, { guildId: "1", channelId: "31", id: "12000", author: { id: "999", isBot: true } }]) assert.equal(projectMetadataEvent("messageDelete", payload, scope), undefined)
    assert.equal(isMetadataLogCommand(["channel", "30"]), false); assert.equal(isMetadataLogCommand(["status"]), false)
    assert.equal(isMetadataLogCommand(["counters"]), true); const parsed = parseMetadataLogCommand(["counters"]); assert(!("error" in parsed)); assert.equal(parsed.type, "query")
    assert(!("error" in parseSafetyCommand("logs", ["status"])))
    assert(!("error" in parseSafetyCommand("logs", ["channel", "30"])))
})

test("actual lost claim response dispatches zero SDK sends and retained claim cannot replay", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot)
        const lost = { ...f.store, work: (input: C.MetadataLogsWorkRequest) => f.store.work(input).pipe(Effect.flatMap((value: C.MetadataLogsWorkResult) => input.operation.type === "claim" && value.type === "claimed" && value.claimed ? Effect.die(new Error("Synthetic lost acknowledged claim")) : Effect.succeed(value))) }
        yield* processMetadataLogsPass(lost, "1", bot.client)
        assert.equal(native.send.requests().length, 0)
        const retained = yield* Effect.promise(() => f.show(record.recordNo)); assert(retained.delivery!.claimedAt !== undefined)
        yield* processMetadataLogsPass(f.store, "1", bot.client); assert.equal(native.send.requests().length, 0)
    }))
    f.advance(130001); await f.cleanup(); assert.equal((await f.show(record.recordNo)).delivery!.state, "uncertain")
})

test("actual lost outcome acknowledgement preserves one native send and never dispatches a second attempt", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot)
        const lost = { ...f.store, work: (input: C.MetadataLogsWorkRequest) => f.store.work(input).pipe(Effect.flatMap((value: C.MetadataLogsWorkResult) => input.operation.type === "outcome" ? Effect.die(new Error("Synthetic lost recorded outcome")) : Effect.succeed(value))) }
        yield* processMetadataLogsPass(lost, "1", bot.client)
        yield* processMetadataLogsPass(f.store, "1", bot.client)
        assert.equal(native.send.requests().length, 1); assert.equal((yield* Effect.promise(() => f.show(record.recordNo))).delivery!.state, "sent")
    }))
})

test("actual delayed claim acknowledgement rechecks postresponse absolute expiry before native invocation", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime, native = nativeSend(bot)
        const delayed = { ...f.store, work: (input: C.MetadataLogsWorkRequest) => f.store.work(input).pipe(Effect.tap((value: C.MetadataLogsWorkResult) => input.operation.type === "claim" && value.type === "claimed" && value.claimed ? advanceNative(f, runtime, 120001) : Effect.void)) }
        yield* processMetadataLogsPass(delayed, "1", bot.client)
        assert.equal(native.send.requests().length, 0)
        const after = yield* Effect.promise(() => f.show(record.recordNo)); assert.equal(after.delivery!.state, "failed"); assert(after.delivery!.claimedAt !== undefined)
        yield* processMetadataLogsPass(f.store, "1", bot.client); assert.equal(native.send.requests().length, 0)
    }))
})

test("actual old outcome callback after module disable retains the claimed immutable destination", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted(), gate = barrier()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect, Fiber }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot)
        const delayed = { ...f.store, work: (input: C.MetadataLogsWorkRequest) => input.operation.type === "outcome" ? Effect.promise(() => gate.wait()).pipe(Effect.andThen(f.store.work(input))) : f.store.work(input) }
        const fiber = yield* Effect.forkChild(processMetadataLogsPass(delayed, "1", bot.client).pipe(Effect.ensuring(Effect.sync(gate.finish))))
        yield* Effect.promise(() => gate.entered); assert.equal(native.send.requests().length, 1)
        yield* Effect.promise(() => f.route("membership", "31")); yield* Effect.promise(() => f.module(false))
        yield* Effect.sync(gate.release); yield* Fiber.join(fiber)
        const after = yield* Effect.promise(() => f.show(record.recordNo)); assert.equal(after.delivery!.state, "sent"); assert.equal(after.delivery!.channelId, "30")
    }))
})

test("actual SDK rejected send keeps admitted record and claimed uncertainty without automatic replay", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot, { failure: true })
        yield* processMetadataLogsPass(f.store, "1", bot.client); yield* processMetadataLogsPass(f.store, "1", bot.client)
        assert.equal(native.send.requests().length, 1); assert.equal(native.exact.requests().length, 0)
        const after = yield* Effect.promise(() => f.show(record.recordNo)); assert.equal(after.delivery!.state, "uncertain"); assert.equal(after.delivery!.messageId, undefined)
        assert(!JSON.stringify(after).includes("Synthetic private provider failure"))
    }))
})

test("actual group-DM report and private-send denial never fall back to public sensitive output", async t => {
    const f = await fixture(t); await f.open(); const before = await f.counters()
    const { handleMetadataPrivateReport } = await import("../../bot/src/metadata-log-management.ts")
    await withNative(f, ({ Effect, Exit, Redacted }, bot) => Effect.gen(function* () {
        bot.rest.respond("GET /channels/90", { body: { id: "90", type: 3, recipients: [bot.fixtures.user({ id: "10" }), bot.fixtures.user({ id: "20" })] } })
        bot.rest.respond("GET /channels/90/messages/17000", { body: bot.fixtures.message({ id: "17000", channel_id: "90", guild_id: undefined, author: bot.fixtures.user({ id: "10", bot: false, system: false }), content: "!logs diagnose" }) })
        const message = yield* bot.client.messages.fetch({ channelId: "90", id: "17000" })
        const context = { message, client: bot.client, reply: () => Effect.die(new Error("Forbidden public report fallback")) }, config = { serverId: "1", token: Redacted.make("synthetic-private-report-token") }
        const forbidden = yield* Effect.exit(handleMetadataPrivateReport(f.store, config, { type: "counters" }, context as any)); assert(Exit.isFailure(forbidden))
        assert(!bot.requests().some((call: { method: string }) => call.method === "POST"))
        bot.rest.respond("GET /channels/90", { body: { id: "90", type: 1, recipients: [bot.fixtures.user({ id: "10", bot: false, system: false })] } })
        bot.rest.respond("POST /channels/90/messages", { status: 403, body: { code: 50013, message: "Synthetic private send forbidden" } })
        const denied = yield* Effect.exit(handleMetadataPrivateReport(f.store, config, { type: "settings" }, context as any)); assert(Exit.isFailure(denied))
        assert(bot.requests().filter((call: { method: string }) => call.method === "POST").every((call: { path: string }) => call.path === "/channels/90/messages"))
    }))
    assert.deepEqual(await f.counters(), before)
})

test("actual claimed native timeout remains uncertain with zero replay after the five-second bound", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted(), gate = barrier()
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime
        const send = bot.rest.respond("POST /channels/30/messages", async () => { await gate.wait(); return { body: bot.fixtures.message({ id: "18000", channel_id: "30", guild_id: "1", author: bot.fixtures.botUser({ id: "999" }), content: "Synthetic late response" }) } })
        const fiber = yield* Effect.forkChild(processMetadataLogsPass(f.store, "1", bot.client).pipe(Effect.ensuring(Effect.sync(gate.finish))))
        yield* Effect.promise(() => gate.entered)
        yield* advanceNative(f, runtime, 5000)
        yield* Effect.sync(gate.release)
        yield* Fiber.join(fiber)
        const after = yield* Effect.promise(() => f.show(record.recordNo)); assert.equal(after.delivery!.state, "uncertain"); assert.equal(after.delivery!.noDispatch, undefined)
        yield* processMetadataLogsPass(f.store, "1", bot.client)
        assert.equal(send.requests().length, 1); assert.equal(after.delivery!.messageId, undefined)
    }))
})

test("actual DEFCON1 pauses delivery while private reports and disabling remain available", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted()
    const { createModerationStore } = await import("../../bot/src/moderation-store.ts")
    const moderation = createModerationStore(f.config)
    await f.run(moderation.manage({ ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot); yield* processMetadataLogsPass(f.store, "1", bot.client); assert.equal(native.send.requests().length, 0)
    }))
    assert.equal((await f.show(record.recordNo)).delivery!.state, "queued")
    await f.query({ type: "counters" }); await f.module(false)
    assert.equal((await f.settings()).enabled, false)
})

test("proven unclaimed no-dispatch permits actual fresh worker generation and rejects the old callback", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted(), oldGrant = await f.reserve(record)
    const stopped = await f.work({ type: "no-dispatch", binding: binding(oldGrant) }); assert.equal(stopped.type, "record")
    assert.equal(stopped.record.delivery!.state, "failed"); assert.equal(stopped.record.delivery!.noDispatch, true)
    await f.reject(f.store.work({ serverId: "1", operation: { type: "claim", binding: binding(oldGrant), context: f.context(), claimToken: "a".repeat(32) } }), f.MetadataLogsStoreError, 409)
    f.advance(60000)
    const { processMetadataLogsPass } = await import("../../bot/src/metadata-log-worker.ts")
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeSend(bot); yield* processMetadataLogsPass(f.store, "1", bot.client)
        assert.equal(native.send.requests().length, 1)
        const current = yield* Effect.promise(() => f.show(record.recordNo)); assert.equal(current.delivery!.generation, 2); assert.equal(current.delivery!.state, "sent")
    }))
    await f.reject(f.store.work({ serverId: "1", operation: { type: "outcome", binding: binding(oldGrant), claimToken: "a".repeat(32), outcome: "sent", messageId: "19000", observedAt: f.now() } }), f.MetadataLogsStoreError, 409)
    const attempts = await f.backend.run(ctx => ctx.db.query("metadataLogAttempts").withIndex("by_binding", q => q.eq("serverId", "1").eq("recordNo", record.recordNo)).collect())
    assert.equal(attempts.length, 2); assert.equal(attempts[0]!.delivery.state, "failed"); assert.equal(attempts[0]!.delivery.noDispatch, true)
    assert.equal(attempts[0]!.delivery.generation, 1); assert.equal(attempts[1]!.delivery.generation, 2)
    assert.equal(attempts[1]!.delivery.state, "sent")
})

test("atomic claiming wins against no-dispatch and leaves native uncertainty discoverable only as status", async t => {
    const f = await fixture(t); await f.open(); const record = await f.admitted(), grant = await f.reserve(record)
    assert((await f.claim(grant)).claimed)
    await f.reject(f.store.work({ serverId: "1", operation: { type: "no-dispatch", binding: binding(grant) } }), f.MetadataLogsStoreError, 409)
    assert.equal((await f.show(record.recordNo)).delivery!.noDispatch, undefined)
    assert(!(await f.discover()).records.some(row => row.recordNo === record.recordNo))
})
