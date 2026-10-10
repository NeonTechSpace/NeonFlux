import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processGreetingsPass, startGreetingsWorker, greetingsCandidateBudget, greetingsPagesPerPass } from "../src/welcome-worker.ts"
import { GreetingsStoreError } from "../src/welcome-store.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { platform, token } from "./moderation-fixture.ts"

test("due candidates retain the exact pacing wake despite another row's later eligibility deadline", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); platform(bot); yield* bot.ready()
        remote.store.pending = () => Effect.succeed({ scanAt: 0, nextClaimAt: 6000, nextCheckAt: 60000, candidates: [{ deliveryId: "synthetic_due", route: "welcome", routeRevision: 1,
            userId: f.ids.user, joinedAt: new Date(0).toISOString(), memberGeneration: 1, channelId: f.ids.channel, hasEmbed: false }] })
        const result = yield* processGreetingsPass(remote.store, f.ids.guild, bot.client)
        assert.equal(result.nextWakeAt, 6000); assert.equal(result.considered, 0)
        assert.equal(remote.calls.some(c => c.method === "reserve"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("one pass reads a bounded number of pages without due candidates and continues in a later pass", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); platform(bot); yield* bot.ready()
        let reads = 0
        remote.store.pending = () => Effect.sync(() => ({ scanAt: 0, nextClaimAt: 0, candidates: [], ...(++reads < 50 ? { nextCursor: `synthetic-${reads}` } : {}) }))
        const result = yield* processGreetingsPass(remote.store, f.ids.guild, bot.client)
        assert.equal(reads, greetingsPagesPerPass)
        assert.deepEqual(result, { considered: 0, nextWakeAt: 60000 })
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a later exact-member deferral cannot replace the earlier global pacing timer", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scheduled = yield* Deferred.make<void>(), deferred = yield* Deferred.make<void>(), awakened = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); platform(bot); yield* bot.ready()
        let globalCalls = 0
        remote.store.pending = input => Effect.gen(function* () {
            if (input.userId) {
                yield* Deferred.succeed(deferred, undefined)
                return { scanAt: 0, candidates: [], nextClaimAt: 0, nextCheckAt: 60000 }
            }
            globalCalls++
            if (globalCalls === 1) { yield* Deferred.succeed(scheduled, undefined); return { scanAt: 0, candidates: [], nextClaimAt: 6000 } }
            assert.equal(yield* Clock.currentTimeMillis, 6000); yield* Deferred.succeed(awakened, undefined)
            return { scanAt: 6000, candidates: [], nextClaimAt: 0 }
        })
        const worker = yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client)
        yield* Deferred.await(scheduled); yield* worker.notify(f.ids.user); yield* Deferred.await(deferred)
        yield* TestClock.adjust("6000 millis"); yield* Deferred.await(awakened)
        assert.equal(globalCalls, 2)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("one candidate pass has a finite read budget and progresses past fresh eligibility failures", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot); p.channel.remove()
        const channel = bot.rest.respond(`GET /channels/${f.ids.channel}`, { status: 403, body: { message: "Synthetic inaccessible destination" } })
        let deferred = 0
        remote.store.pending = () => Effect.sync(() => ({ scanAt: 0, nextClaimAt: 0,
            candidates: Array.from({ length: 10 }, (_, i) => ({ deliveryId: `synthetic_${deferred}_${i}`, route: "welcome" as const, routeRevision: 1,
                userId: p.targetId, joinedAt: "2026-01-01T00:00:00Z", memberGeneration: 1, channelId: f.ids.channel, hasEmbed: false })), nextCursor: `private_synthetic_${deferred}` }))
        remote.store.defer = input => Effect.sync(() => { assert.equal(input.reason, "eligibility"); deferred++; return { deferred: true } })
        yield* bot.ready(); const result = yield* processGreetingsPass(remote.store, f.ids.guild, bot.client)
        assert.equal(result.considered, greetingsCandidateBudget); assert.equal(deferred, greetingsCandidateBudget)
        assert.equal(channel.requests().length, greetingsCandidateBudget); assert.equal(p.replies.requests().length, 0)
        assert.equal(remote.calls.some(c => c.method === "reserve" || c.method === "dispatch"), false)
    })))
})

test("bounded discovery completes before pending reads and continues privately on the next pass", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Deferred.make<void>(), resumed = yield* Deferred.make<void>(), order: string[] = []
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); platform(bot); yield* bot.ready()
        remote.store.discover = input => Effect.sync(() => {
            order.push(`discover:${input.cursor ?? "start"}`)
            if (input.cursor) assert.equal(input.scanAt, 0)
            return { scanAt: input.scanAt ?? 0, examined: 10, queued: 0, ...(input.cursor === "private_b" ? {} : { nextCursor: input.cursor ? "private_b" : "private_a" }) }
        })
        let pending = 0
        remote.store.pending = () => Effect.gen(function* () {
            order.push("pending"); pending++
            if (pending === 1) yield* Deferred.succeed(first, undefined)
            else yield* Deferred.succeed(resumed, undefined)
            return { scanAt: yield* Clock.currentTimeMillis, candidates: [], nextClaimAt: 0 }
        })
        yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client); yield* Deferred.await(first)
        assert.deepEqual(order, ["discover:start", "discover:private_a", "pending"])
        yield* TestClock.adjust("60000 millis"); yield* Deferred.await(resumed)
        assert.deepEqual(order, ["discover:start", "discover:private_a", "pending", "discover:private_b", "pending"])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("saved claimed deliveries are not native-retried by startup discovery or hints", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot); yield* bot.ready()
        remote.store.pending = () => Effect.gen(function* () { yield* Deferred.succeed(observed, undefined); return { scanAt: yield* Clock.currentTimeMillis, candidates: [], nextClaimAt: 0 } })
        remote.store.reserve = () => Effect.fail(new GreetingsStoreError({ operation: "reserve", status: 409 }))
        yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client); yield* Deferred.await(observed)
        assert.equal(p.replies.requests().length, 0); assert.equal(p.open.requests().length, 0)
        assert.equal(remote.calls.some(c => c.method === "outcome" || c.method === "dispatch"), false)
    })))
})

test("due waiting discovery backlog resumes at sixty seconds without an immediate database scan loop", { timeout: 10000 }, async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Deferred.make<void>(), resumed = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot); yield* bot.ready()
        let discoveryReads = 0, pendingReads = 0
        remote.store.discover = input => Effect.sync(() => {
            discoveryReads++
            return { scanAt: input.scanAt ?? 0, examined: 10, queued: 0, nextCursor: `private_${discoveryReads}` }
        })
        remote.store.pending = () => Effect.gen(function* () {
            pendingReads++
            if (pendingReads === 1) yield* Deferred.succeed(first, undefined)
            else { assert.equal(yield* Clock.currentTimeMillis, 60000); yield* Deferred.succeed(resumed, undefined) }
            return { scanAt: yield* Clock.currentTimeMillis, candidates: [], nextClaimAt: 0, nextCheckAt: 0 }
        })
        yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client); yield* Deferred.await(first)
        assert.equal(discoveryReads, 2)
        yield* TestClock.adjust("60000 millis"); yield* Deferred.await(resumed)
        assert.equal(discoveryReads, 4); assert.equal(p.target.requests().length, 0); assert.equal(p.replies.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a supervised discovery failure resumes one bounded server read at sixty seconds without native writes", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const failed = yield* Deferred.make<void>(), resumed = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot); yield* bot.ready()
        let count = 0
        remote.store.discover = () => Effect.gen(function* () {
            if (++count === 1) { yield* Deferred.succeed(failed, undefined); return yield* Effect.fail(new GreetingsStoreError({ operation: "discover", status: null })) }
            assert.equal(yield* Clock.currentTimeMillis, 60000); return { scanAt: 60000, examined: 0, queued: 0 }
        })
        remote.store.pending = () => Effect.gen(function* () { yield* Deferred.succeed(resumed, undefined); return { scanAt: 60000, candidates: [], nextClaimAt: 0 } })
        yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client); yield* Deferred.await(failed)
        yield* TestClock.adjust("60000 millis"); yield* Deferred.await(resumed)
        assert.equal(count, 2); assert.equal(p.replies.requests().length, 0); assert.equal(p.target.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("an expired private discovery scan starts a new bounded session instead of reusing its stale cutoff", { timeout: 10000 }, async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const paused = yield* Deferred.make<void>(), resumed = yield* Deferred.make<void>(), returnFirst = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })); platform(bot); yield* bot.ready()
        let reads = 0
        remote.store.discover = input => Effect.gen(function* () {
            reads++
            if (reads <= 2) return { scanAt: 0, examined: 10, queued: 0, nextCursor: `private_${reads}` }
            assert.equal(input.cursor, undefined); assert.equal(input.scanAt, undefined)
            assert.equal(yield* Clock.currentTimeMillis, 86400001)
            return { scanAt: 86400001, examined: 0, queued: 0 }
        })
        remote.store.pending = () => Effect.gen(function* () {
            if (reads <= 2) { yield* Deferred.succeed(paused, undefined); yield* Deferred.await(returnFirst) }
            else yield* Deferred.succeed(resumed, undefined)
            return { scanAt: yield* Clock.currentTimeMillis, candidates: [], nextClaimAt: 0 }
        })
        const worker = yield* startGreetingsWorker(remote.store, f.ids.guild, bot.client); yield* Deferred.await(paused)
        yield* TestClock.adjust("86400001 millis"); yield* worker.notify(); yield* Deferred.succeed(returnFirst, undefined); yield* Deferred.await(resumed)
        assert.equal(reads, 3)
    })).pipe(Effect.provide(TestClock.layer())))
})
