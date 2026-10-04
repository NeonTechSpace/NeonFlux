import assert from "node:assert/strict"
import nodeTest, { after, type TestContext } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { makeFunctionReference } from "convex/server"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createCleanupStore, CleanupStoreError } from "../../bot/src/cleanup-store.ts"
import { processCleanupPass } from "../../bot/src/cleanup-worker.ts"
import { createModerationStore } from "../../bot/src/moderation-store.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const proofCalls = { http: 0, sdkReads: 0, sdkDeletes: 0 }
after(t => t.diagnostic(`Cleanup contract call totals ${JSON.stringify(proofCalls)}, zero real network or native deletions`))
const joinedAt = "2020-02-29T00:30:00.123456789+00:00"
const owner: C.ModerationActor = { userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const routes = ["/cleanup/manage", "/cleanup/query", "/cleanup/work"]
const modules = {
    "../convex/cleanup.ts": () => import("../convex/cleanup.ts"),
    "../convex/cleanupWork.ts": () => import("../convex/cleanupWork.ts"),
    "../convex/cleanupRetention.ts": () => import("../convex/cleanupRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
}

async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    t.after(() => { proofCalls.http += f.calls.length })
    const store = createCleanupStore(f.config), wrongStore = createCleanupStore(f.wrongConfig)
    const member = (userId: string, isBot = false): C.EventsMemberContext => ({ userId, joinedAt, roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
    const context = (channelId = "30", actor = owner): C.CleanupContext => ({ observedAt: f.now(), actor, member: member(actor.userId), channelId, channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot", botMember: member("999", true) })
    const manageInput = (operation: C.CleanupManageOperation, current = context()): C.CleanupManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.CleanupManageOperation, current = context()) => f.run<C.CleanupManageResult>(store.manage(manageInput(operation, current)))
    const queryInput = (operation: C.CleanupQueryRequest["operation"], current = context()): C.CleanupQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: C.CleanupQueryRequest["operation"], current = context()) => f.run<C.CleanupQueryResult>(store.query(queryInput(operation, current)))
    const settings = async () => { const result = await query({ type: "settings" }); assert.equal(result.type, "settings"); return result.settings }
    const policy = async (channelId = "30") => { const result = await query({ type: "show", channelId }, context(channelId)); assert.equal(result.type, "policy"); return result.policy }
    const status = async (channelId = "30") => { const result = await query({ type: "status", channelId }, context(channelId)); assert.equal(result.type, "status"); return result }
    const configure = async (channelId = "30", ageMs = 3600000) => {
        const result = await manage({ type: "configure", channelId, expectedRevision: 0, ageMs }, context(channelId)); assert(!result.duplicate && result.type === "policy"); return result.policy
    }
    const open = async (channelId = "30", ageMs = 3600000) => {
        const current = await configure(channelId, ageMs)
        await manage({ type: "enable", channelId, expectedRevision: current.revision, enabled: true, confirm: true }, context(channelId))
        const module = await settings()
        if (!module.enabled) await manage({ type: "module", expectedRevision: module.revision, enabled: true })
        return policy(channelId)
    }
    const work = (operation: C.CleanupWorkRequest["operation"]) => f.run<C.CleanupWorkResult>(store.work({ serverId: "1", operation }))
    const start = async (channelId = "30") => { const current = await policy(channelId), value = await work({ type: "start", channelId, expectedRevision: current.revision, context: context(channelId) }); assert.equal(value.type, "sweep"); return value }
    const message = (createdAt = f.now() - 3600001, channelId = "30", offset = 1): C.CleanupMessage => ({ messageId: (((BigInt(createdAt) - 1420070400000n) << 22n) + BigInt(offset)).toString(), channelId, serverId: "1", observedAt: f.now(), createdAt: new Date(createdAt).toISOString(), authorId: "20", authorBot: false, authorSystem: false, type: 0, pinned: false, webhookId: null })
    const persist = async (messages: C.CleanupMessage[], channelId = "30") => {
        const { sweep } = await start(channelId), value = await work({ type: "page", binding: binding(sweep), pageNo: sweep.pageNo, before: sweep.before, messages, context: context(channelId) }); assert.equal(value.type, "page"); return value
    }
    const reserve = async (target: C.CleanupTarget) => { const value = await work({ type: "reserve", binding: targetBinding(target), message: { ...target.message, observedAt: f.now() }, context: context(target.channelId) }); assert.equal(value.type, "reserved"); return value.grant }
    const claim = async (target: C.CleanupTarget, claimToken = "a".repeat(32)) => { const value = await work({ type: "claim", binding: targetBinding(target), message: { ...target.message, observedAt: f.now() }, context: context(target.channelId), claimToken }); assert.equal(value.type, "claimed"); return value }
    const outcome = (target: C.CleanupTarget, outcome: Extract<C.CleanupWorkRequest["operation"], { type: "outcome" }>["outcome"], extra: { claimToken?: string, noDispatch?: true, observation?: C.CleanupObservation } = {}) => work({ type: "outcome", binding: targetBinding(target), outcome, ...extra })
    const cleanup = () => f.backend.mutation(makeFunctionReference<"mutation">("cleanupRetention:cleanup"), {})
    return { ...f, store, wrongStore, context, manageInput, manage, queryInput, query, settings, policy, status, configure, open, work, start, message, persist, reserve, claim, outcome, cleanup }
}

function binding(value: C.CleanupSweepBinding): C.CleanupSweepBinding { return { channelId: value.channelId, policyRevision: value.policyRevision, moduleRevision: value.moduleRevision, sweepNo: value.sweepNo } }
function targetBinding(value: C.CleanupTargetBinding): C.CleanupTargetBinding { return { ...binding(value), pageNo: value.pageNo, targetNo: value.targetNo, messageId: value.messageId } }

async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Clock, Effect, Exit, Deferred, Fiber, Random } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions, snowflakes } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Clock, Effect, Exit, Deferred, Fiber, Random, TestClock, Permissions, snowflakes, createTestBot }
}

async function withNative(f: Awaited<ReturnType<typeof adapterFixture>>, body: (runtime: Awaited<ReturnType<typeof sdk>>, bot: any) => any, onRetry?: (delay: number) => void) {
    const runtime = await sdk(), { Clock, Effect, Random, TestClock, Permissions, createTestBot } = runtime
    return f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const clock = yield* Clock.Clock, origin = clock.monotonicTimeNanosUnsafe()
        const monotonicTimeNanosUnsafe = () => clock.monotonicTimeNanosUnsafe() - origin
        const sdkClock = { ...clock, monotonicTimeNanosUnsafe, monotonicTimeNanos: Effect.sync(monotonicTimeNanosUnsafe) }
        const bot = yield* createTestBot({ token: "synthetic-cleanup-adapter-sdk-token", ...(onRetry ? { logging: { level: "debug", dedupe: false, sink: (record: { code: string, delayMs?: number }) => { if (record.code === "rest.retry" || record.code === "ratelimit.wait") onRetry(record.delayMs!) } } } : {}) }).pipe(Effect.provideService(Clock.Clock, sdkClock)), native = bot.fixtures
        const staffRole = native.role({ permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.ManageMessages).toString() })
        const everyone = native.role({ id: "1", permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /users/999", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10", name: "Synthetic cleanup server" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [everyone, staffRole, botRole] })
        for (const userId of ["10", "11"]) {
            const user = native.user({ id: userId, bot: false, system: false })
            bot.rest.respond(`GET /users/${userId}`, { body: user })
            bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user, roles: [staffRole.id], joined_at: joinedAt, communication_disabled_until: null }) })
        }
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], joined_at: joinedAt, communication_disabled_until: null }) })
        for (const id of ["30", "31"]) bot.rest.respond(`GET /channels/${id}`, { body: native.channel({ id, guild_id: "1", type: 0 }) })
        yield* body(runtime, bot).pipe(Effect.ensuring(Effect.sync(() => {
            const calls = bot.requests() as { method: string, path: string, matched: boolean }[]
            assert(calls.every(call => call.matched), JSON.stringify(calls.filter(call => !call.matched).map(({ method, path }) => ({ method, path }))))
            proofCalls.sdkReads += calls.filter(call => call.method === "GET").length
            proofCalls.sdkDeletes += calls.filter(call => call.method === "DELETE").length
        })))
    })).pipe(Random.withSeed("synthetic-cleanup-sdk-retry"), Effect.provide(TestClock.layer())))
}

function advanceNative(f: Awaited<ReturnType<typeof adapterFixture>>, runtime: Awaited<ReturnType<typeof sdk>>, milliseconds: number) {
    assert(milliseconds >= 0)
    return runtime.Effect.sync(() => f.advance(milliseconds)).pipe(runtime.Effect.andThen(runtime.TestClock.adjust(`${milliseconds} millis`)))
}

// Barriers pause actual adapter work without replacing a response or grant
function barrier() {
    let entered!: () => void, release!: () => void, rejectReached!: (error: Error) => void, wasEntered = false
    const reached = new Promise<void>((done, reject) => { entered = done; rejectReached = reject })
    const released = new Promise<void>(done => { release = done })
    return { reached, release, finish: () => { if (!wasEntered) rejectReached(new Error("Worker completed before reaching the requested real boundary")) }, wait: async () => { wasEntered = true; entered(); await released } }
}

function nativeMessages(f: Awaited<ReturnType<typeof fixture>>, bot: any, records: C.CleanupMessage[], options: { history?: (before: string) => C.CleanupMessage[], exact?: (record: C.CleanupMessage, count: number) => any, deleted?: (record: C.CleanupMessage) => any } = {}) {
    const messages = new Map(records.map(record => [record.messageId, record]))
    const reads = new Map<string, number>(), removed = new Set<string>()
    const wire = (record: C.CleanupMessage) => bot.fixtures.message({ id: record.messageId, channel_id: record.channelId, guild_id: record.serverId ?? undefined,
        author: bot.fixtures.user({ id: record.authorId ?? "20", bot: record.authorBot ?? undefined, system: record.authorSystem ?? undefined }),
        timestamp: record.createdAt ?? undefined, type: record.type ?? undefined, pinned: record.pinned ?? undefined, webhook_id: record.webhookId ?? undefined,
        content: "Synthetic private message body that must never be persisted", attachments: [] })
    const history = bot.rest.respond("GET /channels/:channel/messages", (request: { path: string, query: Record<string, string> }) => {
        assert.equal(request.query.limit, "50")
        const before = request.query.before!
        assert(before, "Every history request uses the persisted boundary")
        const channelId = request.path.split("/")[2]
        const page = options.history ? options.history(before) : records.filter(record => record.channelId === channelId && BigInt(record.messageId) < BigInt(before) && !removed.has(record.messageId)).slice(0, 50)
        return { body: page.map(wire) }
    })
    const fetch = bot.rest.respond("GET /channels/:channel/messages/:message", (request: { path: string }) => {
        const id = request.path.split("/").at(-1)!, record = messages.get(id)
        if (!record || removed.has(id)) return { status: 404, body: { message: "Synthetic missing exact message", code: 10008 } }
        const count = (reads.get(id) ?? 0) + 1; reads.set(id, count)
        return options.exact ? options.exact(record, count) : { body: wire(record) }
    })
    const remove = bot.rest.respond("DELETE /channels/:channel/messages/:message", (request: { path: string }) => {
        const id = request.path.split("/").at(-1)!, record = messages.get(id)
        assert(record, "A delete binds a known exact target")
        assert.equal(request.path.split("/")[2], record.channelId)
        if (options.deleted) return options.deleted(record)
        removed.add(id)
        return { status: 204 }
    })
    return { messages, removed, reads, wire, history, fetch, remove }
}

test("cleanup authenticates every actual route and preserves disabled defaults", async t => {
    const f = await fixture(t), settings = await f.settings()
    assert.equal(settings.enabled, false); assert.equal(settings.policies, 0); assert.equal(settings.retainedTargets, 0)
    for (const effect of [f.wrongStore.manage(f.manageInput({ type: "module", expectedRevision: settings.revision, enabled: true })), f.wrongStore.query(f.queryInput({ type: "settings" })), f.wrongStore.work({ serverId: "1", operation: { type: "list" } })]) await f.reject(effect, CleanupStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), CleanupStoreError, 403)
    const configured = await f.configure(); assert.equal(configured.enabled, false)
    await f.reject(f.store.manage(f.manageInput({ type: "enable", channelId: "30", expectedRevision: configured.revision, enabled: true })), CleanupStoreError, 400)
    const list = await f.work({ type: "list" }); assert.equal(list.type, "policies"); assert.deepEqual(list.policies, [])
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)), new Set(routes))
})

test("actual cleanup discovery persists raw page before exact claim delete and records204 separately", async t => {
    const f = await fixture(t); await f.open()
    const row = f.message(), gate = barrier(), operations: string[] = []
    await withNative(f, ({ Effect, Fiber, snowflakes }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row])
        const wrapped = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.CleanupWorkResult) => Effect.gen(function* () {
            operations.push(input.operation.type)
            if (input.operation.type === "page" && result.type === "page" && result.targets.length) yield* Effect.promise(() => gate.wait())
        }))) }
        const fiber = yield* Effect.forkChild(processCleanupPass(wrapped, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached)
        const saved = yield* Effect.promise(() => f.status())
        assert(saved.page); assert.equal(saved.page.items.length, 1); assert.equal(saved.page.items[0]!.message.messageId, row.messageId)
        assert.equal(saved.page.before, snowflakes.boundary(new Date(f.now() - 3600000)))
        assert.equal(native.remove.requests().length, 0); assert.equal(native.fetch.requests().length, 0)
        assert(!JSON.stringify(saved).includes("Synthetic private message body"))
        yield* Effect.sync(() => gate.release()); yield* Fiber.join(fiber)
        assert.equal(native.remove.requests().length, 1, JSON.stringify({ operations, calls: f.calls, saved: yield* Effect.promise(() => f.status()) }))
        assert(native.fetch.requests().length >= 1, "Fresh raw exact evidence is gathered")
        assert(operations.indexOf("list") < operations.indexOf("start")); assert(operations.indexOf("page") < operations.indexOf("reserve")); assert(operations.indexOf("reserve") < operations.indexOf("claim")); assert(operations.indexOf("claim") < operations.indexOf("outcome"))
    }))
    const saved = await f.status(); assert.equal(saved.targets[0]!.state, "deleted")
    assert.equal(saved.sweep!.counts.acknowledged, 1); assert.equal(saved.sweep!.counts.observedAbsent, 0)
    assert(f.calls.some(call => call.path === "/cleanup/work" && call.status === 200))
})

test("strict cutoff equality native timestamp consistency and public boundary never admit newer targets", async t => {
    const f = await fixture(t); await f.open()
    const cutoff = f.now() - 3600000, old = f.message(cutoff - 1), equal = f.message(cutoff), newer = f.message(cutoff + 1), inconsistent = { ...f.message(cutoff - 2), createdAt: new Date(cutoff - 10000).toISOString() }
    const input = f.queryInput({ type: "preview", channelId: "30", messages: [newer, equal, old, inconsistent] })
    const readback = await f.backend.query(makeFunctionReference<"query">("cleanup:query"), { request: input })
    t.diagnostic(JSON.stringify({ previewCounts: { eligible: readback.eligible, skipped: readback.skipped, unknown: readback.unknown }, items: readback.items.map((item: C.CleanupPageItem) => ({ reason: item.reason, disposition: item.disposition })) }))
    const preview = await f.run<C.CleanupQueryResult>(f.store.query(input)); assert.equal(preview.type, "preview"); assert.deepEqual(preview, readback)
    assert.equal(preview.cutoffAt, cutoff); assert.equal(preview.eligible, 1)
    assert.equal(preview.items.find(item => item.message.messageId === equal.messageId)!.reason, "too-new")
    assert.equal(preview.items.find(item => item.message.messageId === inconsistent.messageId)!.reason, "timestamp-unknown")
    await withNative(f, ({ Effect, snowflakes }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [newer, equal, old])
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests()[0].query.before, snowflakes.boundary(new Date(cutoff)))
        assert.deepEqual([...native.removed], [old.messageId])
    }))
})

const protections: readonly [string, Partial<C.CleanupMessage>][] = [
    ["pinned true", { pinned: true }], ["unknown pin", { pinned: null }],
    ["bot author", { authorBot: true }],
    ["system author", { authorSystem: true }],
    ["webhook", { webhookId: "888" }], ["system type", { type: 6 }], ["unknown type", { type: null }],
    ["unknown timestamp", { createdAt: null }],
]
for (const [name, metadata] of protections) test(`actual raw SDK ${name} fails closed with zero deletes`, async t => {
    const f = await fixture(t); await f.open(); const row = { ...f.message(), ...metadata }
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row])
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
        assert(native.history.requests().length > 0)
        assert(!bot.requests().some((request: { method: string }) => request.method === "DELETE"))
    }))
    const saved = await f.status(); assert.equal(saved.sweep!.counts.acknowledged, 0)
    assert(!JSON.stringify(saved).includes("Synthetic private message body"))
})

test("actual exclusion and disabled or unresolved native ownership predicates preserve exact human references", async t => {
    const f = await fixture(t); await f.open()
    const rows = Array.from({ length: 6 }, (_, index) => f.message(f.now() - 3600001 - index)), [author, explicit, post, unresolved, panel, eligible] = rows
    assert(author && explicit && post && unresolved && panel && eligible)
    author.authorId = "21"
    for (const [kind, id] of [["author", "21"], ["message", explicit.messageId]] as const) {
        const p = await f.policy(); await f.manage({ type: "exclude", channelId: "30", expectedRevision: p.revision, kind, id, add: true })
    }
    await f.backend.run(async ctx => {
        await ctx.db.insert("publishingPosts", { serverId: "1", postNo: 1, generation: 1, channelId: "30", botId: "999", messageId: post.messageId, outcome: "sent", createdAt: f.now(), updatedAt: f.now() })
        await ctx.db.insert("publishingAttempts", { serverId: "1", postNo: 2, generation: 1, sourceId: "100", actorId: "10", botId: "999", action: "edit", channelId: "30", messageId: unresolved.messageId, content: { content: "" }, canonicalContent: { content: "" }, dispatchExpiresAt: f.now(), nativeDeadlineMs: 5000, outcome: "uncertain", unresolved: true, createdAt: f.now() })
        await ctx.db.insert("rolePanels", { serverId: "1", name: "disabled", kind: "reaction", revision: 1, enabled: false, exclusive: false, mappings: [], withdrawing: false, published: { revision: 1, publishedAt: f.now(), postNo: 3, postGeneration: 1, channelId: "30", messageId: panel.messageId, botId: "999", content: { content: "" }, mappings: [], exclusive: false } })
    })
    const preview = await f.query({ type: "preview", channelId: "30", messages: rows }); assert.equal(preview.type, "preview"); assert.equal(preview.eligible, 1)
    assert.deepEqual(preview.items.map(item => item.reason), ["excluded-author", "excluded-message", "protected", "protected", "protected", undefined])
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.deepEqual([...native.removed], [eligible.messageId])
    }))
})

test("short nonempty pages and oldest raw excluded cursor survive restart until an empty page", async t => {
    const f = await fixture(t); await f.open()
    const newer = f.message(), rawOldest = { ...f.message(f.now() - 3600010), pinned: true }, older = f.message(f.now() - 3600020)
    let boundary = ""
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, snowflakes } = runtime
        boundary = snowflakes.boundary(new Date(f.now() - 3600000))
        const native = nativeMessages(f, bot, [newer, rawOldest, older], { history: before => before === boundary ? [newer, rawOldest] : before === rawOldest.messageId ? [older] : [] })
        yield* processCleanupPass(f.store, "1", bot.client)
        const saved = yield* Effect.promise(() => f.status())
        assert(saved.sweep); assert.notEqual(saved.sweep.state, "complete", "Short nonempty page alone cannot establish end")
        assert.equal(saved.sweep.before, rawOldest.messageId)
        assert.deepEqual([...native.removed], [newer.messageId])
    }))
    f.advance(60000)
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [older], { history: before => before === rawOldest.messageId ? [older] : [] })
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests()[0].query.before, rawOldest.messageId)
        assert.deepEqual([...native.removed], [older.messageId])
    }))
    f.advance(60000)
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [], { history: () => [] })
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests()[0].query.before, older.messageId)
        assert.equal(native.remove.requests().length, 0)
    }))
    const saved = await f.status(); assert.equal(saved.sweep!.state, "complete")
})

for (const malformed of ["duplicate", "unordered", "wrong-channel", "cursor-stall"] as const) test(`actual ${malformed} history blocks visibly without destructive dispatch`, async t => {
    const f = await fixture(t); await f.open(); const old = f.message(), older = f.message(f.now() - 3600010)
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [old, older], { history: before => malformed === "duplicate" ? [old, old] : malformed === "unordered" ? [older, old] : malformed === "wrong-channel" ? [{ ...old, channelId: "31" }] : [{ ...old, messageId: before, createdAt: new Date(f.now() - 3600000).toISOString() }] })
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
    }))
    const saved = await f.status(); assert(saved.policy.blockedReason); assert.equal(saved.sweep!.counts.acknowledged, 0)
})

test("atomic duplicate claim never authorizes a second dispatch including the same token", async t => {
    const f = await fixture(t); await f.open(); const page = await f.persist([f.message()]), target = page.targets[0]!
    await f.reserve(target)
    const [first, second] = await Promise.all([f.claim(target), f.claim(target)])
    assert.equal(Number(first.claimed) + Number(second.claimed), 1)
    assert.equal((await f.claim(target, "b".repeat(32))).claimed, false)
    const recorded = await f.outcome(target, "deleted", { claimToken: "a".repeat(32) }); assert.equal(recorded.type, "target"); assert.equal(recorded.target.state, "deleted")
    await f.reject(f.store.work({ serverId: "1", operation: { type: "claim", binding: targetBinding(target), message: target.message, context: f.context(), claimToken: "a".repeat(32) } }), CleanupStoreError, 409)
})

test("partial persisted page resumes queued targets after process restart with five-delete channel budget", async t => {
    const f = await fixture(t); await f.open(); const rows = Array.from({ length: 7 }, (_, index) => f.message(f.now() - 3600001 - index))
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 5)
        const saved = yield* Effect.promise(() => f.status())
        assert(saved.page); assert.equal(saved.page.nextBefore, rows.at(-1)!.messageId)
        assert.equal(saved.targets.filter((target: C.CleanupTarget) => target.state === "queued").length, 2)
    }))
    f.advance(60000)
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows.slice(5))
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests().length, 0, "A durable pending page is resumed before reading another page")
        assert.deepEqual([...native.removed], rows.slice(5).map(row => row.messageId))
    }))
    const saved = await f.status(); assert.equal(saved.sweep!.counts.acknowledged, 7); assert.equal(saved.sweep!.before, rows.at(-1)!.messageId)
})

test("invoked403 preserves failed unresolved target across page advancement and restart without replay", async t => {
    const f = await fixture(t); await f.open(); const rows = [f.message(), f.message(f.now() - 3600002)]
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows, { deleted: row => row.messageId === rows[0]!.messageId ? { status: 403, body: { message: "Synthetic forbidden delete" } } : { status: 204 } })
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().filter((request: { path: string }) => request.path.endsWith(rows[0]!.messageId)).length, 1)
    }))
    const first = await f.status(), failed = first.targets.find(target => target.messageId === rows[0]!.messageId)!
    assert(["failed", "uncertain"].includes(failed.state)); assert.equal(failed.noDispatch, undefined)
    f.advance(130000)
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().filter((request: { path: string }) => request.path.endsWith(rows[0]!.messageId)).length, 0)
    }))
    const after = await f.status(), retained = after.targets.find(target => target.targetNo === failed.targetNo)!
    assert.equal(retained.state, failed.state); assert.equal(retained.finishedAt, failed.finishedAt)
})

test("lost actual claim response retains unknown dispatch anchor and never retries exact target", async t => {
    const f = await fixture(t); await f.open(); const row = f.message()
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime, native = nativeMessages(f, bot, [row])
        const lost = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.flatMap((result: C.CleanupWorkResult) => input.operation.type === "claim" && result.type === "claimed" && result.claimed ? Effect.die(new Error("Synthetic lost acknowledged claim response")) : Effect.succeed(result))) }
        yield* processCleanupPass(lost, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
        const saved = yield* Effect.promise(() => f.status()); assert(saved.targets[0]!.claimedAt); assert.equal(saved.targets[0]!.noDispatch, undefined)
        yield* advanceNative(f, runtime, 130001)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
    }))
    assert.equal((await f.status()).targets[0]!.state, "uncertain")
})

for (const change of ["policy", "module", "DEFCON1"] as const) test(`actual ${change} change after page persistence fences unclaimed deletion`, async t => {
    const f = await fixture(t); await f.open(); const row = f.message(), gate = barrier()
    await withNative(f, ({ Effect, Fiber }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row])
        const paused = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.CleanupWorkResult) => input.operation.type === "page" && result.type === "page" && result.targets.length ? Effect.promise(() => gate.wait()) : Effect.void)) }
        const fiber = yield* Effect.forkChild(processCleanupPass(paused, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached)
        yield* Effect.promise(async () => {
            if (change === "policy") { const p = await f.policy(); await f.manage({ type: "enable", channelId: "30", expectedRevision: p.revision, enabled: false }) }
            else if (change === "module") { const s = await f.settings(); await f.manage({ type: "module", expectedRevision: s.revision, enabled: false }) }
            else await f.run(createModerationStore(f.config).manage({ ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
        })
        yield* Effect.sync(() => gate.release()); yield* Fiber.join(fiber)
        assert.equal(native.remove.requests().length, 0)
    }))
    const sweeps = await f.backend.run(ctx => ctx.db.query("cleanupSweeps").collect())
    assert.equal(sweeps.length, 1); assert.equal(sweeps[0]!.counts.acknowledged, 0)
    if (change !== "DEFCON1") assert.equal(sweeps[0]!.state, "cancelled")
})

test("DEFCON2 housekeeping remains independent of manual moderation enablement", async t => {
    const f = await fixture(t); await f.open()
    await f.run(createModerationStore(f.config).manage({ ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2, manualModerationEnabled: false } } }))
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [f.message()]); yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 1)
    }))
})

test("claimed backend expiry keeps original uncertainty when an exact late204 callback arrives", async t => {
    const f = await fixture(t); await f.open(); const page = await f.persist([f.message()]), target = page.targets[0]!
    const grant = await f.reserve(target); assert.equal(grant.nativeDeadlineMs, 5000)
    assert.equal(grant.dispatchExpiresAt, f.now() + 120000)
    assert((await f.claim(target)).claimed)
    f.advance(130001); await f.cleanup()
    const before = (await f.status()).targets[0]!; assert.equal(before.state, "uncertain"); assert.equal(before.expiresAt, undefined)
    const late = await f.outcome(target, "deleted", { claimToken: "a".repeat(32) }); assert.equal(late.type, "target")
    assert.equal(late.target.state, "uncertain"); assert.equal(late.target.finishedAt, before.finishedAt); assert.equal(late.target.lateOutcome, "deleted")
    assert.equal(late.target.noDispatch, undefined)
})

test("actual delayed claim acknowledgement samples postresponse clock and absolute expiry prevents SDK delete", async t => {
    const f = await fixture(t); await f.open(); const row = f.message()
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime, native = nativeMessages(f, bot, [row])
        const delayed = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.CleanupWorkResult) => input.operation.type === "claim" && result.type === "claimed" && result.claimed ? advanceNative(f, runtime, result.grant.dispatchExpiresAt - f.now()) : Effect.void)) }
        yield* processCleanupPass(delayed, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
    }))
    const saved = (await f.status()).targets[0]!; assert.equal(saved.noDispatch, true); assert.notEqual(saved.state, "deleted")
})

test("actual claimed callback retains original generation after policy disable", async t => {
    const f = await fixture(t); await f.open(); const row = f.message(), gate = barrier()
    await withNative(f, ({ Effect, Fiber }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row])
        const late = { ...f.store, work: (input: C.CleanupWorkRequest) => input.operation.type === "outcome" && input.operation.outcome === "deleted"
            ? Effect.promise(() => gate.wait()).pipe(Effect.andThen(f.store.work(input))) : f.store.work(input) }
        const fiber = yield* Effect.forkChild(processCleanupPass(late, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached); assert.equal(native.remove.requests().length, 1)
        const p = yield* Effect.promise(() => f.policy())
        yield* Effect.promise(() => f.manage({ type: "enable", channelId: "30", expectedRevision: p.revision, enabled: false }))
        yield* Effect.sync(() => gate.release()); yield* Fiber.join(fiber)
    }))
    const saved = await f.status(), target = saved.targets[0]!
    assert.equal(target.state, "deleted"); assert(target.policyRevision < saved.policy.revision)
    assert.equal(target.noDispatch, undefined)
})

test("actual native interruption after request invocation records uncertainty with no retry", async t => {
    const f = await fixture(t); await f.open(); const row = f.message(), gate = barrier()
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime
        const native = nativeMessages(f, bot, [row], { deleted: async () => { await gate.wait(); return { status: 204 } } })
        const fiber = yield* Effect.forkChild(processCleanupPass(f.store, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached); assert.equal(native.remove.requests().length, 1)
        yield* Fiber.interrupt(fiber)
        yield* Effect.sync(() => gate.release())
        const before = yield* Effect.promise(() => f.status()); assert.equal(before.targets[0]!.state, "uncertain"); assert.equal(before.targets[0]!.noDispatch, undefined)
        yield* advanceNative(f, runtime, 130001)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 1)
    }))
})

test("thirty-day settled retention physically erases audits while unresolved anchors remain", async t => {
    const f = await fixture(t); await f.open(); const page = await f.persist([f.message(), f.message(f.now() - 3600002)]), [settled, unknown] = page.targets
    assert(settled && unknown)
    for (const target of [settled, unknown]) { await f.reserve(target); assert((await f.claim(target)).claimed) }
    await f.outcome(settled, "deleted", { claimToken: "a".repeat(32) }); await f.outcome(unknown, "uncertain", { claimToken: "a".repeat(32) })
    const initial = await f.status(), preserved = initial.targets.find(target => target.targetNo === unknown.targetNo)!
    assert.equal(initial.settings.retainedTargets, 2)
    f.advance(30 * 86400000 - 1); await f.cleanup(); assert.equal((await f.settings()).retainedTargets, 2)
    f.advance(1); await f.cleanup(); await f.backend.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    const after = await f.status(); assert.equal(after.settings.retainedTargets, 1); assert.deepEqual(after.targets[0], preserved)
    assert.deepEqual((await f.status()).targets[0], preserved)
})

test("bounded actual history reads do not issue per-message raw requests for fifty protected rows", async t => {
    const f = await fixture(t); await f.open(); const rows = Array.from({ length: 50 }, (_, index) => ({ ...f.message(f.now() - 3600001 - index), pinned: true }))
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, rows)
        const result = yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests().length, 1, "One raw history page read")
        assert.equal(native.fetch.requests().length, 0); assert.equal(native.remove.requests().length, 0); assert.equal(result.attempted, 0)
    }))
    const saved = await f.status(); assert.equal(saved.settings.retainedTargets, 0); assert.equal(saved.page, null); assert.equal(saved.sweep!.counts.scanned, 50)
})

for (const outcome of ["deleted", "failed", "uncertain"] as const) test(`actual ${outcome} budget preserves due priority across three backlogged passes`, async t => {
    const f = await fixture(t), rows: C.CleanupMessage[] = []
    const channels = Array.from({ length: 5 }, (_, index) => String(100 + index))
    for (const [index, channelId] of channels.entries()) { await f.open(channelId); rows.push(...Array.from({ length: 25 }, (_, message) => f.message(f.now() - 3600001 - message, channelId, index + 1))) }
    const untouched = await f.policy(channels[4]!)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime
        for (let index = 0; index < 5; index++) { const channelId = String(100 + index); bot.rest.respond(`GET /channels/${channelId}`, { body: bot.fixtures.channel({ id: channelId, guild_id: "1", type: 0 }) }) }
        const native = nativeMessages(f, bot, rows, outcome === "deleted" ? {} : { deleted: () => {
            if (outcome === "uncertain") throw new Error("Synthetic transport lost the delete response")
            return { status: 403, body: { message: "Synthetic rejected deletion" } }
        } })
        const cumulative: number[][] = [], calls: C.CleanupWorkRequest[] = []
        const counted = { ...f.store, work: (input: C.CleanupWorkRequest) => { calls.push(input); return f.store.work(input) } }
        let cursor: C.CleanupWorkCursor | undefined
        for (let pass = 0; pass < 3; pass++) {
            const sdkOffset = bot.requests().length, deleteOffset = native.remove.requests().length, workOffset = calls.length
            const result = yield* processCleanupPass(counted, "1", bot.client, cursor)
            cursor = result.nextCursor
            assert.equal(result.considered, 4); assert.equal(result.attempted, 20); assert.equal(result.hasMore, true); assert.equal(cursor, undefined)
            assert.equal(result.acknowledged, outcome === "deleted" ? 20 : 0); assert.equal(result.unresolved, outcome === "deleted" ? 0 : 20)
            const deletes = native.remove.requests().slice(deleteOffset) as { path: string }[]
            assert.equal(deletes.length, 20)
            for (const channelId of channels) assert(deletes.filter(request => request.path.split("/")[2] === channelId).length <= 5)
            const visited = new Set(calls.slice(workOffset).flatMap(input => "channelId" in input.operation ? [input.operation.channelId] : "binding" in input.operation ? [input.operation.binding.channelId] : []))
            const skipped = channels.filter(channelId => !visited.has(channelId)); assert.equal(skipped.length, 1)
            assert(!(bot.requests().slice(sdkOffset) as { path: string }[]).some(request => skipped.some(channelId => request.path.startsWith(`/channels/${channelId}`))))
            if (pass === 0) {
                const after = yield* Effect.promise(() => f.status(channels[4]!))
                assert.deepEqual(after.policy, untouched, "No due metadata touched after budget exhaustion")
                assert.equal(after.sweep, null); assert.equal(after.page, null); assert.deepEqual(after.targets, [])
            }
            const saved = yield* Effect.promise(() => Promise.all(channels.map(channelId => f.status(channelId))))
            cumulative.push(channels.map(channelId => native.remove.requests().filter((request: { path: string }) => request.path.split("/")[2] === channelId).length))
            for (const status of saved) if (status.sweep) {
                assert.equal(status.sweep.before, runtime.snowflakes.boundary(new Date(status.sweep.cutoffAt)), "Partial durable page keeps its original boundary")
                assert(status.page); assert.equal(status.page.before, status.sweep.before); assert.equal(status.page.nextBefore, rows.filter(row => row.channelId === status.policy.channelId).at(-1)!.messageId)
                assert(status.targets.some((target: C.CleanupTarget) => target.state === "queued"), "Every visited policy remains backlogged")
                assert(status.targets.filter((target: C.CleanupTarget) => target.state !== "queued").every((target: C.CleanupTarget) => target.state === outcome))
            }
            if (pass < 2) yield* advanceNative(f, runtime, 60000)
        }
        assert.deepEqual(cumulative, [[5, 5, 5, 5, 0], [10, 10, 10, 5, 5], [15, 15, 15, 10, 5]])
        assert.equal(new Set(native.remove.requests().map((request: { path: string }) => request.path)).size, 60, "Settled or uncertain targets are never replayed")
        t.diagnostic(`${outcome} three-pass cumulative fixture DELETEs ${JSON.stringify(cumulative)}`)
        assert(!bot.requests().some((request: { path: string }) => request.path.includes("bulk-delete")))
    }))
})

test("budget exhaustion reuses the actual incoming discovery cursor without skipping its fifth policy", async t => {
    const f = await fixture(t), channels = Array.from({ length: 25 }, (_, index) => String(100 + index)), rows: C.CleanupMessage[] = []
    for (const [index, channelId] of channels.entries()) { await f.open(channelId); if (index >= 20) rows.push(...Array.from({ length: 15 }, (_, message) => f.message(f.now() - 3600001 - message, channelId, index + 1))) }
    const untouched = await f.policy(channels[24]!)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime
        for (const channelId of channels) bot.rest.respond(`GET /channels/${channelId}`, { body: bot.fixtures.channel({ id: channelId, guild_id: "1", type: 0 }) })
        const native = nativeMessages(f, bot, rows)
        const first = yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(first.considered, 20); assert.equal(first.attempted, 0); assert(first.nextCursor)
        const second = yield* processCleanupPass(f.store, "1", bot.client, first.nextCursor)
        assert.equal(second.considered, 4); assert.equal(second.attempted, 20); assert.equal(second.hasMore, true); assert.deepEqual(second.nextCursor, first.nextCursor)
        const after = yield* Effect.promise(() => f.status(channels[24]!))
        assert.deepEqual(after.policy, untouched); assert.equal(after.sweep, null); assert.equal(after.page, null); assert.deepEqual(after.targets, [])
        assert(!(bot.requests() as { path: string }[]).some(request => request.path.startsWith(`/channels/${channels[24]}`)))
        yield* advanceNative(f, runtime, 60000)
        const third = yield* processCleanupPass(f.store, "1", bot.client, second.nextCursor)
        assert.equal(third.considered, 1); assert.equal(third.attempted, 5); assert.equal(third.hasMore, false); assert.equal(third.nextCursor, undefined)
        assert.equal(native.remove.requests().filter((request: { path: string }) => request.path.split("/")[2] === channels[24]).length, 5)
        const fifth = yield* Effect.promise(() => f.status(channels[24]!)); assert(fifth.page); assert.equal(fifth.targets.filter((target: C.CleanupTarget) => target.state === "queued").length, 10)
        for (const channelId of channels.slice(20, 24)) assert((yield* Effect.promise(() => f.status(channelId))).targets.some((target: C.CleanupTarget) => target.state === "queued"))
    }))
})

test("actual SDK429 destructive retry remains SDK-owned with one backend claim and bounded absolute clock", async t => {
    const f = await fixture(t); await f.open(); const row = f.message()
    let observe!: () => void, rejectObserved!: (error: Error) => void, retryDelay = 0, didObserve = false
    const observed = new Promise<void>((resolve, reject) => { observe = resolve; rejectObserved = reject })
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime
        let attempts = 0, claims = 0
        const native = nativeMessages(f, bot, [row], { deleted: () => ++attempts === 1 ? { status: 429, headers: { "retry-after": "0.1" }, body: { message: "Synthetic bounded rate limit", retry_after: 0.1, global: false } } : { status: 204 } })
        const counted = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.CleanupWorkResult) => Effect.sync(() => { if (input.operation.type === "claim" && result.type === "claimed" && result.claimed) claims++ }))) }
        const fiber = yield* Effect.forkChild(processCleanupPass(counted, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => { if (!didObserve) rejectObserved(new Error("Worker completed without actual SDK rate-limit evidence")) }))))
        yield* Effect.promise(() => observed)
        assert(retryDelay > 0 && retryDelay < 5000)
        yield* advanceNative(f, runtime, Math.ceil(retryDelay))
        yield* Fiber.join(fiber)
        assert.equal(claims, 1); assert.equal(attempts, 2); assert.equal(native.remove.requests().length, 2)
    }), delay => { didObserve = true; retryDelay = delay; observe() })
    const saved = await f.status(); assert.equal(saved.targets[0]!.state, "deleted"); assert.equal(saved.sweep!.counts.acknowledged, 1)
})

test("actual explicitly human ordinary reply in Announcement channel is eligible", async t => {
    const f = await fixture(t); await f.open(); const row = { ...f.message(), type: 19 }
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        bot.rest.respond("GET /channels/30", { body: bot.fixtures.channel({ id: "30", guild_id: "1", type: 5 }) })
        const native = nativeMessages(f, bot, [row])
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 1)
    }))
    assert.equal((await f.status()).targets[0]!.state, "deleted")
})

for (const type of [2, 4]) test(`actual disallowed channel type${type} cannot start history or dispatch`, async t => {
    const f = await fixture(t); await f.open()
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        bot.rest.respond("GET /channels/30", { body: bot.fixtures.channel({ id: "30", guild_id: "1", type }) })
        const native = nativeMessages(f, bot, [f.message()])
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.history.requests().length, 0); assert.equal(native.remove.requests().length, 0)
    }))
    assert.equal((await f.policy()).blockedReason, "authority")
})

test("actual SDK429 past five-second deadline retains invoked rejection without application replay", async t => {
    const f = await fixture(t); await f.open(); const row = f.message()
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row], { deleted: () => ({ status: 429, headers: { "retry-after": "6" }, body: { message: "Synthetic rate limit beyond native deadline", retry_after: 6, global: false } }) })
        let nativeError: { _tag: string, operation: string, status: number, outcome: string } | undefined
        const client = { ...bot.client, messages: { ...bot.client.messages, delete: (target: any, options: any) => bot.client.messages.delete(target, options).pipe(runtime.Effect.tapError((error: any) => runtime.Effect.sync(() => { nativeError = error }))) } }
        yield* processCleanupPass(f.store, "1", client)
        assert.equal(native.remove.requests().length, 1)
        const target = (yield* runtime.Effect.promise(() => f.status())).targets[0]!
        assert(nativeError); assert.equal(nativeError._tag, "MessageOperationError"); assert.equal(nativeError.operation, "delete"); assert.equal(nativeError.status, 429); assert.equal(nativeError.outcome, "rejected")
        assert.equal(target.state, "failed"); assert.equal(target.noDispatch, undefined)
        yield* advanceNative(f, runtime, 130001)
        yield* processCleanupPass(f.store, "1", bot.client)
        assert.equal(native.remove.requests().length, 1)
    }))
})

test("actual typed fresh target absence records observation separately without claiming cleanup deletion", async t => {
    const f = await fixture(t); await f.open(); const row = f.message()
    await withNative(f, ({ Effect }, bot) => Effect.gen(function* () {
        const native = nativeMessages(f, bot, [row])
        const disappeared = { ...f.store, work: (input: C.CleanupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.CleanupWorkResult) => Effect.sync(() => {
            if (input.operation.type === "page" && result.type === "page" && result.targets.length) native.removed.add(row.messageId)
        }))) }
        yield* processCleanupPass(disappeared, "1", bot.client)
        assert.equal(native.remove.requests().length, 0)
    }))
    const saved = await f.status(), target = saved.targets[0]!
    assert.equal(target.state, "absent"); assert.equal(target.noDispatch, true)
    assert.equal(target.observation!.status, "absent"); assert.equal(target.observation!.channelVisible, true)
    assert.equal(saved.sweep!.counts.observedAbsent, 1); assert.equal(saved.sweep!.counts.acknowledged, 0); assert.equal(saved.sweep!.counts.submitted, 0)
})
