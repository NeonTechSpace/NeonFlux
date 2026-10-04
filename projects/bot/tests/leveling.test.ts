import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Deferred, Redacted, Exit } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { levelCandidate, processLevelCandidate, startLevelCreditWorker } from "../src/leveling.ts"
import { createLevelQueue, levelQueueCapacity } from "../src/level-queue.ts"
import { levelsBoundary } from "./level-fixture.ts"
import { token, platform, boundary } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { ticketBoundary } from "./ticket-fixture.ts"
import { ResponseStoreError, type ResponseStore } from "../src/responses-store.ts"
import type { AfkStore } from "../src/afk-store.ts"
import type * as C from "@neonflux/backend/contracts"

const secret = Redacted.make("synthetic-leveling-secret-for-test-only")
const candidate = (userId: string, createdAt = 0): C.LevelingCandidate => ({ userId, createdAt, messageId: "123456789012345680", channelId: "123456789012345681", digest: "a".repeat(64) })
const fence = { scoreEpoch: 3, adjustmentRevision: 4, mappingRevision: 5 }

test("bounded collection retains only keyed domain-separated digests and original source time", () => {
    const f = createFixtures()
    // Test the SDK's public message projection through a native event in the integration test below.
    const native = { guildId: f.ids.guild, id: f.nextId(), channelId: f.ids.channel, author: { id: f.ids.user, isBot: false, isSystem: false },
        type: 0, content: "  HＥLLO\nWorld ", createdAt: "2026-10-01T00:00:00Z" } as Parameters<typeof levelCandidate>[0]
    const value = levelCandidate(native, f.ids.guild, secret)!
    assert.deepEqual(Object.keys(value).sort(), ["channelId", "createdAt", "digest", "messageId", "userId"])
    assert.equal(value.createdAt, Date.parse(native.createdAt!))
    assert.match(value.digest, /^[0-9a-f]{64}$/)
    assert.equal(value.digest, levelCandidate({ ...native, content: "hello world" }, f.ids.guild, secret)?.digest)
    assert.notEqual(value.digest, levelCandidate({ ...native, author: { ...native.author, id: f.nextId() } }, f.ids.guild, secret)?.digest)
    assert.notEqual(value.digest, levelCandidate(native, f.ids.guild, Redacted.make("synthetic-rotated-secret"))?.digest)
    const bounded = "a".repeat(4096)
    assert.equal(levelCandidate({ ...native, content: bounded + "different suffix" }, f.ids.guild, secret)?.digest, levelCandidate({ ...native, content: bounded }, f.ids.guild, secret)?.digest)
    const dm = { ...native }; delete dm.guildId
    assert.equal(levelCandidate(dm, f.ids.guild, secret), undefined)
    for (const patch of [{ content: "\u200b \n" }, { guildId: f.nextId() }, { webhookId: f.nextId() },
        { type: 7 }, { author: { ...native.author, isSystem: true } }, { createdAt: "invalid" }])
        assert.equal(levelCandidate({ ...native, ...patch }, f.ids.guild, secret), undefined)
})

test("queue bounds all pending accounts including an active candidate and drops stale or future events", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const queue = yield* createLevelQueue<C.LevelingCandidate>()
        for (let i = 0; i < levelQueueCapacity; i++) assert.equal(yield* queue.offer(candidate(String(i + 1))), true)
        assert.equal(queue.size(), 1000)
        const active = yield* queue.take
        assert.equal(yield* queue.offer(candidate(active.userId)), false)
        assert.equal(yield* queue.offer(candidate("1001")), false)
        yield* queue.release(active)
        assert.equal(yield* queue.offer(candidate("1001")), true)
        yield* TestClock.adjust("600001 millis")
        assert.equal(yield* queue.offer(candidate(active.userId)), false)
        assert.equal(yield* queue.offer(candidate(active.userId, 660002)), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("credit preflight avoids member REST on rejection and binds one fresh member read to original fences", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot)
        p.target.remove()
        const rawEpoch = "1970-01-01T00:00:00.000000Z"
        const target = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), joined_at: rawEpoch, roles: [], communication_disabled_until: null }) })
        yield* bot.ready()
        const remote = levelsBoundary()
        yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId))
        assert.equal(target.requests().length, 0)
        remote.store.preflight = () => Effect.succeed({ eligible: true, policyRevision: 7, fence })
        let request: C.LevelingAwardRequest | undefined
        remote.store.award = input => Effect.sync(() => { request = input; return { awarded: false, reason: "fence" } })
        const result = yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId))
        assert.deepEqual(result, { awarded: false, reason: "fence" })
        assert.equal(target.requests().length, 1)
        assert.equal(request!.member.joinedAt, rawEpoch)
        assert.deepEqual(request!.fence, fence)
        assert.equal(request!.candidate.createdAt, 0)
        assert.equal(request!.observedAt, 0)
        assert.equal(p.guildRoute.requests().length, 0)
        assert.equal(p.rolesRoute.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("credit requires current membership and distinguishes typed absence from provider failures", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot)
        const remote = levelsBoundary({ preflight: () => Effect.succeed({ eligible: true, policyRevision: 1, fence }) })
        yield* bot.ready()
        yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId))
        assert.equal(remote.calls.some(c => c.method === "award"), false)
        p.target.remove()
        let route = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent member" } })
        assert.equal(yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId)), undefined)
        route.remove(); route = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { status: 403, body: { message: "Synthetic denied member" } })
        const denied = yield* Effect.exit(processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId)))
        assert(Exit.isFailure(denied)); assert.equal(remote.calls.some(c => c.method === "award"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("credit worker keeps pending through processing, releases accounts and cancels scoped writes", async () => {
    const f = createFixtures(), remote = levelsBoundary()
    let pendingAfterClose = () => -1, cancelled = false, awards = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), released = yield* Deferred.make<void>(), awarding = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot)
        p.target.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), joined_at: "1970-01-01T00:00:00Z", communication_disabled_until: null }) })
        yield* bot.ready()
        remote.store.preflight = () => Effect.gen(function* () { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(released); return { eligible: true as const, policyRevision: 1, fence } })
        remote.store.award = () => Effect.gen(function* () { awards++; yield* Deferred.succeed(awarding, undefined); yield* Effect.never; return { awarded: false as const, reason: "disabled" as const } })
            .pipe(Effect.ensuring(Effect.sync(() => { cancelled = true })))
        const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
        pendingAfterClose = worker.pending
        assert.equal(yield* worker.offer(candidate(p.targetId)), true); yield* Deferred.await(entered)
        assert.equal(yield* worker.offer(candidate(p.targetId)), false)
        assert.equal(yield* worker.offer(candidate(f.ids.user)), true)
        yield* TestClock.adjust("600001 millis")
        yield* Deferred.succeed(released, undefined); yield* Deferred.await(awarding)
        assert.equal(worker.pending(), 2)
    })).pipe(Effect.provide(TestClock.layer())))
    assert.equal(cancelled, true); assert.equal(awards, 1)
    assert.equal(pendingAfterClose(), 0)
})

test("a queued stale candidate never reaches preflight and failed candidates release their account", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), third = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); yield* bot.ready()
        const seen: string[] = []
        const remote = levelsBoundary({ preflight: input => Effect.gen(function* () {
            seen.push(input.candidate.userId)
            if (seen.length === 1) { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release) }
            else yield* Deferred.succeed(third, undefined)
            return { eligible: false as const, reason: "cooldown" as const }
        }) })
        const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
        yield* worker.offer(candidate("1")); yield* Deferred.await(entered)
        yield* worker.offer(candidate("2")); yield* TestClock.adjust("600001 millis")
        yield* worker.offer(candidate("3", 600001)); yield* Deferred.succeed(release, undefined); yield* Deferred.await(third)
        assert.deepEqual(seen, ["1", "3"])
        assert.equal(yield* worker.offer(candidate("1", 600001)), true)
        assert.equal(remote.calls.some(c => c.method === "award"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a disabled preflight never suppresses later candidates, so enabling from any surface takes effect", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const second = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); yield* bot.ready()
        const seen: string[] = []
        const remote = levelsBoundary({ preflight: input => Effect.gen(function* () {
            seen.push(input.candidate.userId)
            if (seen.length === 2) yield* Deferred.succeed(second, undefined)
            return { eligible: false as const, reason: "disabled" as const }
        }) })
        const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
        assert.equal(yield* worker.offer(candidate("1")), true)
        assert.equal(yield* worker.offer(candidate("2")), true)
        yield* Deferred.await(second)
        assert.deepEqual(seen, ["1", "2"])
        assert.equal(remote.calls.some(c => c.method === "award"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("native collection follows successful protection and rejects blocked creates, edits and nonhuman sources", async t => {
    const f = createFixtures()
    t.mock.method(globalThis, "fetch", async () => {
        throw new Error("Unexpected HTTP")
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const admitted = yield* Deferred.make<C.LevelingCandidate>()
        const remote = levelsBoundary({ preflight: input => Effect.gen(function* () { yield* Deferred.succeed(admitted, input.candidate); return { eligible: false as const, reason: "disabled" as const } }) })
        const moderation = boundary({ evaluate: input => Effect.succeed({ duplicate: false, blocked: input.content === "Blocked by protection" }) })
        moderation.current.automodEnabled = true
        const afk: AfkStore = { set: (userId, reason) => Effect.succeed({ userId, reason, since: 0 }), observe: () => Effect.succeed({ cleared: false, statuses: [] }) }
        const responses: ResponseStore = { manage: () => Effect.fail(new ResponseStoreError({ operation: "manage", status: 403 })),
            evaluate: () => Effect.succeed({ send: false }) }
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, backend: { siteUrl: "https://synthetic-test.convex.site", secret } }, { afk, responses, moderation: moderation.store, publishing: publishingBoundary().store, roles: rolesBoundary().store, greetings: greetingsBoundary().store, tickets: ticketBoundary().store, leveling: remote.store })), p = platform(bot)
        yield* bot.ready()
        const base = { timestamp: "1970-01-01T00:00:00Z" }
        const dm = { ...bot.fixtures.message({ content: "Direct message", channel_id: f.nextId(), ...base }) }; delete dm.guild_id
        const excluded = [bot.fixtures.message({ content: "Blocked by protection", ...base }), dm,
            bot.fixtures.message({ content: "Bot message", author: bot.fixtures.botUser(), ...base }),
            bot.fixtures.message({ content: "Webhook message", webhook_id: f.nextId(), ...base }),
            bot.fixtures.message({ content: "System message", type: 7, ...base }),
            bot.fixtures.message({ content: "Other server", guild_id: f.nextId(), ...base }),
            bot.fixtures.message({ content: "  ", ...base }), bot.fixtures.message({ content: "!ping", ...base })]
        for (const input of excluded) { yield* bot.emit("MESSAGE_CREATE", input); yield* bot.idle() }
        yield* bot.emit("MESSAGE_UPDATE", bot.fixtures.message({ content: "Edited message", edited_timestamp: "1970-01-01T00:00:01Z", ...base })); yield* bot.idle()
        const valid = bot.fixtures.message({ content: "Eligible human create", ...base })
        yield* bot.emit("MESSAGE_CREATE", valid)
        const accepted = yield* Deferred.await(admitted); yield* bot.idle()
        assert.equal(accepted.messageId, valid.id)
        assert.equal(remote.calls.filter(c => c.method === "preflight").length, 1)
        assert.equal(bot.failures().length, 0)
        assert(p.actor.requests().length > 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("foreground native message handling completes while XP preflight remains blocked", async t => {
    const f = createFixtures(), remote = levelsBoundary()
    let preflights = 0
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected foreground HTTP") })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), released = yield* Deferred.make<void>()
        remote.store.preflight = () => Effect.gen(function* () { preflights++; yield* Deferred.succeed(entered, undefined); yield* Deferred.await(released); return { eligible: false as const, reason: "disabled" as const } })
        const afk: AfkStore = { set: (userId, reason) => Effect.succeed({ userId, reason, since: 0 }), observe: () => Effect.succeed({ cleared: false, statuses: [] }) }
        const responses: ResponseStore = { manage: () => Effect.fail(new ResponseStoreError({ operation: "manage", status: 403 })),
            evaluate: () => Effect.succeed({ send: false }) }
        const options = createBotOptions({ token, serverId: f.ids.guild, backend: { siteUrl: "https://synthetic-test.convex.site", secret } }, { afk, responses, moderation: boundary().store, publishing: publishingBoundary().store, roles: rolesBoundary().store, greetings: greetingsBoundary().store, tickets: ticketBoundary().store, leveling: remote.store })
        const bot = yield* createTestBot(options), p = platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "Hello from a human", timestamp: "1970-01-01T00:00:00Z" }))
        yield* Deferred.await(entered); yield* bot.idle()
        // The unrelated response handler already performs one member read. XP is still at preflight.
        assert.equal(p.actor.requests().length, 1)
        assert.equal(preflights, 1)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(preflights, 1)
        assert.equal(bot.failures().length, 0)
        yield* Deferred.succeed(released, undefined)
    })).pipe(Effect.provide(TestClock.layer())))
})
