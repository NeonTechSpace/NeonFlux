import assert from "node:assert/strict"
import nodeTest from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Queue } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { AnalyticsStoreError, type AnalyticsStore } from "../src/analytics-store.ts"
import { analyticsRecheckMs, analyticsResendMs, analyticsWindowMs, startAnalyticsWorker } from "../src/analytics-worker.ts"
import { platform, token } from "./moderation-fixture.ts"

// A hang guard only. Every wait inside is a controlled clock step, an awaited flush or a gate the test opens
const test = (name: string, body: () => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const HOUR = 3600000, DAY = 86400000, serverId = createFixtures().ids.guild
// 2026-10-09T10:54:30Z. After five idle minutes the first test counts thirty seconds before an hour boundary
const start = Date.UTC(2026, 9, 9, 10, 54, 30)
const counts = (request: C.AnalyticsRecordRequest) => ({ hours: request.hours, days: request.days })

// An in-memory backend boundary. Every record call lands in a queue, so tests await each flush instead of sleeping
function analyticsBoundary(options: { enabled?: boolean, fail?: (input: C.AnalyticsRecordRequest) => number | undefined, hold?: (input: C.AnalyticsRecordRequest) => Effect.Effect<void> } = {}) {
    const state = { enabled: options.enabled ?? true, settingsReads: 0, manages: [] as C.AnalyticsManageRequest[], records: [] as C.AnalyticsRecordRequest[], calls: [] as string[] }
    const flushed = Effect.runSync(Queue.unbounded<C.AnalyticsRecordRequest>()), reads = Effect.runSync(Queue.unbounded<void>())
    const store: AnalyticsStore = {
        settings: () => Effect.sync(() => { state.settingsReads++; Queue.offerUnsafe(reads, undefined); return { enabled: state.enabled } }),
        manage: input => Effect.sync(() => { state.manages.push(input); state.enabled = input.enabled; return { enabled: input.enabled } }),
        record: input => Effect.suspend(() => {
            state.records.push(structuredClone(input)); state.calls.push("record")
            Queue.offerUnsafe(flushed, input)
            const status = options.fail?.(input)
            return (options.hold?.(input) ?? Effect.void).pipe(Effect.andThen(status === undefined ? Effect.succeed({ enabled: state.enabled, recorded: state.enabled })
                : Effect.fail(new AnalyticsStoreError({ operation: "record", status }))))
        }),
        summary: () => Effect.sync(() => { state.calls.push("summary"); return { enabled: state.enabled, since: Math.floor(start / DAY) * DAY - 6 * DAY, joins: 4, leaves: 1, messages: 1234,
            topChannels: [{ channelId: "500", count: 1000 }, { channelId: "501", count: 234 }], busiestHours: [{ hour: 18, count: 600 }, { hour: 9, count: 34 }] } }),
    }
    return { state, store, next: Queue.take(flushed), read: Queue.take(reads) }
}

const scenario = <A>(body: Effect.Effect<A, unknown, import("effect").Scope.Scope>, at = start) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    yield* TestClock.setTime(at)
    return yield* body
})).pipe(Effect.provide(TestClock.layer())))
type Runtime = Effect.Success<ReturnType<typeof createTestBot>>
// Every channel reads as a text channel. A flush reads each channel the bot does not hold yet, once
const channelReads = (runtime: Runtime) => runtime.rest.respond("GET /channels/:id", request => ({ body: runtime.fixtures.channel({ id: request.path.split("/").at(-1)!, guild_id: serverId }) }))

test("member messages, joins and leaves accumulate into one numbered flush per window and an idle server sends nothing", async () => {
    const b = analyticsBoundary()
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store })), f = runtime.fixtures
        const reads = channelReads(runtime)
        yield* runtime.ready()
        const other = f.nextId()
        const send = (overrides: Record<string, unknown>) => runtime.emit("MESSAGE_CREATE", runtime.fixtures.message({ guild_id: serverId, ...overrides })).pipe(Effect.andThen(runtime.idle()))
        yield* TestClock.adjust(5 * 60000)
        assert.equal(b.state.records.length, 0)
        assert.equal(b.state.settingsReads, 0)
        yield* send({ content: "hello" })
        yield* send({ content: "again" })
        yield* send({ content: "!ping" })
        yield* send({ content: "elsewhere", channel_id: other })
        // Bots, webhooks, system authors and system message types are never counted
        yield* send({ content: "bot", author: runtime.fixtures.botUser() })
        yield* send({ content: "hook", webhook_id: runtime.fixtures.nextId() })
        yield* send({ content: "system", author: runtime.fixtures.user({ system: true }) })
        yield* send({ content: "", type: 7 })
        const member = runtime.fixtures.member()
        yield* runtime.emit("GUILD_MEMBER_ADD", { ...member, guild_id: serverId }).pipe(Effect.andThen(runtime.idle()))
        yield* runtime.emit("GUILD_MEMBER_ADD", { ...member, guild_id: serverId }).pipe(Effect.andThen(runtime.idle()))
        yield* runtime.emit("GUILD_MEMBER_REMOVE", { guild_id: serverId, user: member.user }).pipe(Effect.andThen(runtime.idle()))
        yield* TestClock.adjust(analyticsWindowMs - 1)
        assert.equal(b.state.records.length, 0)
        yield* TestClock.adjust(1)
        const first = yield* b.next
        const hour = Math.floor(start / HOUR) * HOUR, day = Math.floor(start / DAY) * DAY
        assert.match(first.session, /^[0-9a-f-]{36}$/)
        assert.deepEqual([first.serverId, first.sequence], [serverId, 1])
        assert.deepEqual(counts(first), { hours: [{ channelId: f.ids.channel, hour, count: 3 }, { channelId: other, hour, count: 1 }], days: [{ day, joins: 2, leaves: 1 }] })
        // A message after the hour boundary opens a new bucket in the next window, under the same session
        yield* send({ content: "next hour" })
        yield* TestClock.adjust(analyticsWindowMs)
        const second = yield* b.next
        assert.deepEqual([second.session, second.sequence], [first.session, 2])
        assert.deepEqual(counts(second), { hours: [{ channelId: f.ids.channel, hour: hour + HOUR, count: 1 }], days: [] })
        yield* TestClock.adjust(analyticsWindowMs * 10)
        assert.equal(b.state.records.length, 2)
        // Only the first flush met channels the bot did not hold, one read each
        assert.equal(reads.requests().length, 2)
        assert.equal(runtime.failures().length, 0)
    }))
})

test("analytics off stops counting, activity rereads the setting at most every recheck interval and the chat toggle applies at once", async () => {
    const b = analyticsBoundary({ enabled: false })
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store }))
        const p = platform(runtime)
        channelReads(runtime)
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", runtime.fixtures.message({ content })).pipe(Effect.andThen(runtime.idle()))
        // The first window learns the setting is off. The backend stores nothing for it
        yield* send("hello")
        yield* TestClock.adjust(analyticsWindowMs)
        yield* b.next
        for (const content of ["one", "two", "three"]) yield* send(content)
        yield* TestClock.adjust(analyticsWindowMs * 3)
        assert.equal(b.state.records.length, 1)
        assert.equal(b.state.settingsReads, 0)
        // Idle time alone never reads the setting
        yield* TestClock.adjust(analyticsRecheckMs)
        assert.equal(b.state.settingsReads, 0)
        b.state.enabled = true
        yield* send("activity")
        yield* TestClock.adjust(analyticsWindowMs)
        yield* b.read
        assert.equal(b.state.settingsReads, 1)
        assert.equal(b.state.records.length, 1)
        yield* send("counted")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.equal((yield* b.next).hours[0]!.count, 1)
        // The off command stops counting at once and drops counts not yet flushed
        yield* send("!stats off")
        assert.deepEqual(b.state.manages.map(row => [row.enabled, row.managerAuthorized, row.originServerId]), [[false, true, serverId]])
        assert.match((p.replies.requests().at(-1)!.body as { content: string }).content, /^Analytics is off/)
        yield* send("not counted")
        yield* TestClock.adjust(analyticsWindowMs * 3)
        assert.equal(b.state.records.length, 2)
        // The on command itself arrives while counting is off
        yield* send("!stats on")
        yield* send("counted again")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.equal((yield* b.next).hours[0]!.count, 1)
        assert.equal(runtime.failures().length, 0)
    }))
})

test("counts that fill one request leave before the window ends, and counts added meanwhile leave in requests of at most 500 buckets", async () => {
    // The first request waits on this gate, so the test adds counts while it is in flight
    const gate = Effect.runSync(Deferred.make<void>())
    const b = analyticsBoundary({ hold: input => input.sequence === 1 ? Deferred.await(gate) : Effect.void })
    // The recorder directly, because 1,000 gateway events would only test the transport's event queue
    await scenario(Effect.gen(function* () {
        const recorder = yield* startAnalyticsWorker(b.store, serverId)
        for (let index = 0; index < 500; index++) yield* recorder.message(String(1000 + index))
        // The 500th bucket ends the window without a clock step
        const first = yield* b.next
        assert.deepEqual([first.sequence, first.hours.length, first.days.length], [1, 500, 0])
        for (let index = 0; index < 501; index++) yield* recorder.message(String(2000 + index))
        yield* recorder.join()
        yield* Deferred.succeed(gate, undefined)
        const second = yield* b.next, third = yield* b.next
        assert.deepEqual([second.sequence, third.sequence], [2, 3])
        assert.deepEqual([second.hours.length + second.days.length, third.hours.length + third.days.length], [500, 2])
        assert.equal(new Set([...second.hours, ...third.hours].map(row => row.channelId)).size, 501)
        assert.deepEqual(third.days.map(row => [row.joins, row.leaves]), [[1, 0]])
        assert.equal(b.state.records.length, 3)
    }))
})

test("an unavailable backend gets the same batch each window until it answers, new counts form the next batch and shutdown flushes the open window", async () => {
    // The first batch meets an unavailable backend twice, and the third batch is refused
    const statuses = new Map<number, number[]>([[1, [503, 503]], [3, [400]]])
    const b = analyticsBoundary({ fail: input => statuses.get(input.sequence)?.shift() })
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store }))
        channelReads(runtime)
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", runtime.fixtures.message({ content })).pipe(Effect.andThen(runtime.idle()))
        yield* send("one")
        yield* TestClock.adjust(analyticsWindowMs)
        const failed = yield* b.next
        // Without new activity the batch is sent again next window, unchanged
        yield* TestClock.adjust(analyticsWindowMs)
        assert.deepEqual(yield* b.next, failed)
        // Counts that arrive meanwhile never join the unsent batch, so a batch the backend saved before its reply was lost cannot change
        yield* send("two")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.deepEqual(yield* b.next, failed)
        const next = yield* b.next
        assert.deepEqual([next.session, next.sequence, next.hours[0]!.count], [failed.session, 2, 1])
        yield* TestClock.adjust(analyticsWindowMs * 3)
        assert.equal(b.state.records.length, 4)
        // A refused batch would fail again and is dropped
        yield* send("refused")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.equal((yield* b.next).sequence, 3)
        yield* send("after")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.deepEqual([(yield* b.next).sequence], [4])
        yield* send("open window")
        assert.equal(b.state.records.length, 6)
    }))
    // Closing the bot scope flushes the open window once
    assert.deepEqual(b.state.records.map(row => row.sequence), [1, 1, 1, 2, 3, 4, 5])
    assert.equal(b.state.records[6]!.hours[0]!.count, 1)
})

test("while a batch waits for an unavailable backend, counts that fill a request wait for the window instead of retrying at once", async () => {
    const b = analyticsBoundary({ fail: () => 503 })
    await scenario(Effect.gen(function* () {
        const recorder = yield* startAnalyticsWorker(b.store, serverId)
        for (let index = 0; index < 500; index++) yield* recorder.message(String(1000 + index))
        assert.equal((yield* b.next).sequence, 1)
        for (let index = 0; index < 500; index++) yield* recorder.message(String(2000 + index))
        yield* TestClock.adjust(analyticsWindowMs - 1)
        assert.equal(b.state.records.length, 1)
        yield* TestClock.adjust(1)
        assert.equal((yield* b.next).sequence, 1)
        assert.equal(b.state.records.length, 2)
    }))
})

test("a batch the backend never acknowledges is sent every window for a day and then dropped", async () => {
    let down = true
    const b = analyticsBoundary({ fail: () => down ? 503 : undefined })
    await scenario(Effect.gen(function* () {
        const recorder = yield* startAnalyticsWorker(b.store, serverId)
        yield* recorder.message("500")
        yield* TestClock.adjust(analyticsResendMs + analyticsWindowMs * 2)
        // One attempt when the window closes, then one each window while the batch is at most a day old
        assert.equal(b.state.records.length, analyticsResendMs / analyticsWindowMs + 1)
        assert.ok(b.state.records.every(row => row.sequence === 1))
        down = false
        yield* recorder.message("501")
        yield* TestClock.adjust(analyticsWindowMs)
        assert.deepEqual(b.state.records.slice(analyticsResendMs / analyticsWindowMs + 1).map(row => [row.sequence, row.hours[0]!.channelId]), [[2, "501"]])
    }))
})

test("messages in a thread count under its parent channel, with one channel read for each channel the bot does not hold", async () => {
    const b = analyticsBoundary()
    // 10:00, so every window of this test stays inside one UTC hour
    const at = Date.UTC(2026, 9, 9, 10), hour = at
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store })), f = runtime.fixtures
        const parent = f.ids.channel, other = f.nextId(), thread = f.nextId(), later = f.nextId(), hidden = f.nextId(), announced = f.nextId()
        const parents = new Map([[thread, parent], [later, other], [hidden, parent]])
        let refused = false
        const reads = runtime.rest.respond("GET /channels/:id", request => {
            const id = request.path.split("/").at(-1)!, parentId = parents.get(id)
            return refused && id === hidden ? { status: 403, body: { code: "MISSING_ACCESS", message: "Missing access" } }
                : { body: parentId ? f.thread({ id, guild_id: serverId, parent_id: parentId }) : f.channel({ id, guild_id: serverId }) }
        })
        yield* runtime.ready()
        const send = (channelId: string) => runtime.emit("MESSAGE_CREATE", f.message({ guild_id: serverId, channel_id: channelId, content: "hello" })).pipe(Effect.andThen(runtime.idle()))
        const flush = Effect.gen(function* () { yield* TestClock.adjust(analyticsWindowMs); return (yield* b.next).hours })
        for (const channelId of [thread, thread, parent, other]) yield* send(channelId)
        assert.deepEqual(yield* flush, [{ channelId: parent, hour, count: 3 }, { channelId: other, hour, count: 1 }])
        assert.equal(reads.requests().length, 3)
        // Channels the bot holds cost no read
        yield* send(thread)
        assert.deepEqual(yield* flush, [{ channelId: parent, hour, count: 1 }])
        assert.equal(reads.requests().length, 3)
        // A thread the bot has not seen costs one read, and one whose creation event it saw costs none
        yield* runtime.emit("THREAD_CREATE", { ...f.thread({ id: announced, guild_id: serverId, parent_id: parent }), newly_created: true }).pipe(Effect.andThen(runtime.idle()))
        yield* send(later)
        yield* send(announced)
        assert.deepEqual(yield* flush, [{ channelId: other, hour, count: 1 }, { channelId: parent, hour, count: 1 }])
        assert.equal(reads.requests().length, 4)
        // A failed read counts a new channel under its own ID this time and tries again next window
        refused = true
        yield* send(hidden)
        assert.deepEqual(yield* flush, [{ channelId: hidden, hour, count: 1 }])
        refused = false
        yield* send(hidden)
        assert.deepEqual(yield* flush, [{ channelId: parent, hour, count: 1 }])
        assert.equal(reads.requests().length, 6)
        assert.equal(runtime.failures().length, 0)
    }), at)
})

test("messages in an archived thread count under its parent channel", async () => {
    const b = analyticsBoundary()
    const at = Date.UTC(2026, 9, 9, 10), hour = at
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store })), f = runtime.fixtures
        const thread = f.thread({ guild_id: serverId, parent_id: f.ids.channel })
        // The server's active thread list leaves an archived thread out, so the parent must come from reading the thread itself
        runtime.rest.respond(`GET /guilds/${serverId}/threads/active`, { body: { threads: [], members: [] } })
        const reads = runtime.rest.respond(`GET /channels/${thread.id}`, { body: { ...thread, thread_metadata: { ...thread.thread_metadata, archived: true } } })
        yield* runtime.ready()
        for (let window = 0; window < 2; window++) {
            yield* runtime.emit("MESSAGE_CREATE", f.message({ guild_id: serverId, channel_id: thread.id, content: "hello" })).pipe(Effect.andThen(runtime.idle()))
            yield* TestClock.adjust(analyticsWindowMs)
            assert.deepEqual((yield* b.next).hours, [{ channelId: f.ids.channel, hour, count: 1 }])
        }
        assert.equal(reads.requests().length, 1)
        assert.equal(runtime.failures().length, 0)
    }), at)
})

test("a server active all day sends one request per five-minute window, 288 a day, and every count arrives once", async () => {
    const b = analyticsBoundary()
    await scenario(Effect.gen(function* () {
        const recorder = yield* startAnalyticsWorker(b.store, serverId)
        // A member message every 30 seconds for a whole UTC day
        for (let step = 0; step < 2880; step++) {
            yield* recorder.message("500")
            yield* TestClock.adjust(30000)
        }
    }), Date.UTC(2026, 9, 9))
    assert.equal(b.state.records.length, 288)
    assert.deepEqual(b.state.records.map(row => row.sequence), Array.from({ length: 288 }, (_, index) => index + 1))
    assert.equal(b.state.records.flatMap(row => row.hours).reduce((sum, row) => sum + row.count, 0), 2880)
})

test("stats sends the counts in memory, then replies with a counts-only summary to server managers and refuses other members", async () => {
    const b = analyticsBoundary()
    await scenario(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { analytics: b.store }))
        const p = platform(runtime, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages })
        channelReads(runtime)
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", runtime.fixtures.message({ content })).pipe(Effect.andThen(runtime.idle()))
        const replies = () => p.replies.requests().map(row => (row.body as { content: string }).content)
        yield* send("!stats off")
        yield* send("!stats")
        assert.deepEqual(replies(), ["Only the server owner or members with Manage Server can use stats", "Only the server owner or members with Manage Server can use stats"])
        assert.equal(b.state.manages.length, 0)
        assert.deepEqual(b.state.calls, [])
        p.actor.remove()
        runtime.rest.respond(`GET /guilds/${serverId}/members/${runtime.fixtures.ids.user}`, { body: runtime.fixtures.member({ roles: [p.actorRole.id, p.botRole.id] }) })
        yield* send("!stats")
        // The three stats messages are counted and sent before the summary is read, without waiting for the window
        assert.deepEqual(b.state.calls, ["record", "summary"])
        assert.equal(b.state.records[0]!.hours[0]!.count, 3)
        yield* send("!stats sometimes")
        assert.deepEqual(replies().slice(2), [
            "Last 7 days, UTC, since 2026-10-03\nJoins 4, leaves 1, messages 1,234\nTop channels: <#500> 1,000, <#501> 234\nBusiest hours, UTC: 18:00 600, 09:00 34\nAnalytics is on. The dashboard receives new counts about every five minutes",
            "Use !stats, !stats on or !stats off",
        ])
        assert.equal(runtime.failures().length, 0)
    }))
})
