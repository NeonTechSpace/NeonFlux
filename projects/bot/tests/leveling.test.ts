import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Deferred, Redacted, Exit } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { readCosts } from "../src/costs.ts"
import {
    levelCandidate,
    levelingForgets,
    levelingRechecks,
    processLevelCandidate,
    startLevelCreditWorker,
} from "../src/leveling.ts"
import { createLevelQueue, levelQueueCapacity } from "../src/level-queue.ts"
import { fakeClient, quietSignal } from "./backend-fake.ts"
import { levelProfile, levelsBoundary } from "./level-fixture.ts"
import { token, platform, boundary } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { ticketBoundary } from "./ticket-fixture.ts"
import { ResponseStoreError, type ResponseStore } from "../src/responses-store.ts"
import type { AfkStore } from "../src/afk-store.ts"
import type { LevelingAwardRequest, LevelingCandidate } from "@neonflux/contracts/leveling"

const secret = Redacted.make("synthetic-leveling-secret-for-test-only")
const candidate = (userId: string, createdAt = 0): LevelingCandidate => ({
    userId,
    createdAt,
    messageId: "123456789012345680",
    channelId: "123456789012345681",
    digest: "a".repeat(64),
})
const fence = { scoreEpoch: 3, adjustmentRevision: 4, mappingRevision: 5 }
// Credit reads the candidate's channel once to learn whether it is a thread
const candidateChannel = (bot: Effect.Success<ReturnType<typeof createTestBot>>) =>
    bot.rest.respond("GET /channels/123456789012345681", { body: bot.fixtures.channel({ id: "123456789012345681" }) })

test("a candidate from a thread carries its parent channel, read once per thread", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const thread = bot.fixtures.thread()
                const reads = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
                yield* bot.ready()
                const seen: LevelingCandidate[] = []
                const remote = levelsBoundary({
                    preflight: (input) =>
                        Effect.sync(() => {
                            seen.push(input.candidate)
                            return { eligible: false as const, reason: "excluded" as const }
                        }),
                })
                for (const userId of ["1", "2"])
                    yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, {
                        ...candidate(userId),
                        channelId: thread.id,
                    })
                assert.deepEqual(
                    seen.map((c) => c.parentChannelId),
                    [f.ids.channel, f.ids.channel],
                )
                assert.equal(reads.requests().length, 1)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("bounded collection retains only keyed domain-separated digests and original source time", () => {
    const f = createFixtures()
    // Test the SDK's public message projection through a native event in the integration test below.
    const native = {
        guildId: f.ids.guild,
        id: f.nextId(),
        channelId: f.ids.channel,
        author: { id: f.ids.user, isBot: false, isSystem: false },
        type: 0,
        content: "  HＥLLO\nWorld ",
        createdAt: "2026-10-01T00:00:00Z",
    } as Parameters<typeof levelCandidate>[0]
    const value = levelCandidate(native, f.ids.guild, secret)!
    assert.deepEqual(Object.keys(value).sort(), ["channelId", "createdAt", "digest", "messageId", "userId"])
    assert.equal(value.createdAt, Date.parse(native.createdAt!))
    assert.match(value.digest, /^[0-9a-f]{64}$/)
    assert.equal(value.digest, levelCandidate({ ...native, content: "hello world" }, f.ids.guild, secret)?.digest)
    assert.notEqual(
        value.digest,
        levelCandidate({ ...native, author: { ...native.author, id: f.nextId() } }, f.ids.guild, secret)?.digest,
    )
    assert.notEqual(
        value.digest,
        levelCandidate(native, f.ids.guild, Redacted.make("synthetic-rotated-secret"))?.digest,
    )
    const bounded = "a".repeat(4096)
    assert.equal(
        levelCandidate({ ...native, content: bounded + "different suffix" }, f.ids.guild, secret)?.digest,
        levelCandidate({ ...native, content: bounded }, f.ids.guild, secret)?.digest,
    )
    const dm = { ...native }
    delete dm.guildId
    assert.equal(levelCandidate(dm, f.ids.guild, secret), undefined)
    for (const patch of [
        { content: "\u200b \n" },
        { guildId: f.nextId() },
        { webhookId: f.nextId() },
        { type: 7 },
        { author: { ...native.author, isSystem: true } },
        { createdAt: "invalid" },
    ])
        assert.equal(levelCandidate({ ...native, ...patch }, f.ids.guild, secret), undefined)
})

test("queue bounds all pending accounts including an active candidate and drops stale or future events", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const queue = yield* createLevelQueue<LevelingCandidate>()
                for (let i = 0; i < levelQueueCapacity; i++)
                    assert.equal(yield* queue.offer(candidate(String(i + 1))), true)
                assert.equal(queue.size(), 1000)
                const active = yield* queue.take,
                    skipped = readCosts().optionalSkipped
                assert.equal(yield* queue.offer(candidate(active.userId)), false)
                // A member who already has a pending candidate is a dedupe, and only a full queue counts as a skipped job
                assert.equal(readCosts().optionalSkipped, skipped)
                assert.equal(yield* queue.offer(candidate("1001")), false)
                assert.equal(readCosts().optionalSkipped, skipped + 1)
                yield* queue.release(active)
                assert.equal(yield* queue.offer(candidate("1001")), true)
                yield* TestClock.adjust("600001 millis")
                assert.equal(yield* queue.offer(candidate(active.userId)), false)
                assert.equal(yield* queue.offer(candidate(active.userId, 660002)), false)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("credit preflight avoids member REST on rejection and binds one fresh member read to original fences", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                candidateChannel(bot)
                p.target.remove()
                const rawEpoch = "1970-01-01T00:00:00.000000Z"
                const target = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: p.targetId }),
                        joined_at: rawEpoch,
                        roles: [],
                        communication_disabled_until: null,
                    }),
                })
                yield* bot.ready()
                const remote = levelsBoundary()
                yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId))
                assert.equal(target.requests().length, 0)
                remote.store.preflight = () => Effect.succeed({ eligible: true, policyRevision: 7, fence })
                let request: LevelingAwardRequest | undefined
                remote.store.award = (input) =>
                    Effect.sync(() => {
                        request = input
                        return { awarded: false, reason: "fence" }
                    })
                const result = yield* processLevelCandidate(
                    remote.store,
                    f.ids.guild,
                    bot.client,
                    candidate(p.targetId),
                )
                assert.deepEqual(result, { awarded: false, reason: "fence" })
                assert.equal(target.requests().length, 1)
                assert.equal(request!.member.joinedAt, rawEpoch)
                assert.deepEqual(request!.fence, fence)
                assert.equal(request!.candidate.createdAt, 0)
                assert.equal(request!.observedAt, 0)
                assert.equal(p.guildRoute.requests().length, 0)
                assert.equal(p.rolesRoute.requests().length, 0)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("credit requires current membership and distinguishes typed absence from provider failures", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                candidateChannel(bot)
                const remote = levelsBoundary({
                    preflight: () => Effect.succeed({ eligible: true, policyRevision: 1, fence }),
                })
                yield* bot.ready()
                yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId))
                assert.equal(
                    remote.calls.some((c) => c.method === "award"),
                    false,
                )
                // Leaving drops the cached member, so the next candidate reads Fluxer
                yield* bot.emit("GUILD_MEMBER_REMOVE", {
                    guild_id: f.ids.guild,
                    user: bot.fixtures.user({ id: p.targetId }),
                })
                yield* bot.idle()
                p.target.remove()
                let route = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    status: 404,
                    body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent member" },
                })
                assert.equal(
                    yield* processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId)),
                    undefined,
                )
                route.remove()
                route = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    status: 403,
                    body: { message: "Synthetic denied member" },
                })
                const denied = yield* Effect.exit(
                    processLevelCandidate(remote.store, f.ids.guild, bot.client, candidate(p.targetId)),
                )
                assert(Exit.isFailure(denied))
                assert.equal(
                    remote.calls.some((c) => c.method === "award"),
                    false,
                )
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("credit worker keeps pending through processing, releases accounts and cancels scoped writes", async () => {
    const f = createFixtures(),
        remote = levelsBoundary()
    let pendingAfterClose = () => -1,
        cancelled = false,
        awards = 0
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>(),
                    awarding = yield* Deferred.make<void>()
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                candidateChannel(bot)
                p.target.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: p.targetId }),
                        joined_at: "1970-01-01T00:00:00Z",
                        communication_disabled_until: null,
                    }),
                })
                yield* bot.ready()
                remote.store.preflight = () =>
                    Effect.gen(function* () {
                        yield* Deferred.succeed(entered, undefined)
                        yield* Deferred.await(released)
                        return { eligible: true as const, policyRevision: 1, fence }
                    })
                remote.store.award = () =>
                    Effect.gen(function* () {
                        awards++
                        yield* Deferred.succeed(awarding, undefined)
                        return yield* Effect.never
                    }).pipe(
                        Effect.ensuring(
                            Effect.sync(() => {
                                cancelled = true
                            }),
                        ),
                    )
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                pendingAfterClose = worker.pending
                assert.equal(yield* worker.offer(candidate(p.targetId)), true)
                yield* Deferred.await(entered)
                assert.equal(yield* worker.offer(candidate(p.targetId)), false)
                assert.equal(yield* worker.offer(candidate(f.ids.user)), true)
                yield* TestClock.adjust("600001 millis")
                yield* Deferred.succeed(released, undefined)
                yield* Deferred.await(awarding)
                assert.equal(worker.pending(), 2)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
    assert.equal(cancelled, true)
    assert.equal(awards, 1)
    assert.equal(pendingAfterClose(), 0)
})

// The guard's signal interrupts a wait for a message that never comes and closes the bot, so a missing message fails
test(
    "a level-up posts one message where the member leveled up or in the chosen channel, notifying nobody, and a failed send stops nothing",
    { timeout: 60000 },
    async (t) => {
        const f = createFixtures(),
            remote = levelsBoundary(),
            here = "123456789012345681",
            chosen = "123456789012345699",
            later = "123456789012345698",
            members = ["123456789012345671", "123456789012345672", "123456789012345673", "123456789012345674"]
        const announced: Array<{ level: number; channelId: string | null } | undefined> = [
            { level: 2, channelId: null },
            { level: 3, channelId: chosen },
            undefined,
            { level: 4, channelId: later },
        ]
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                    platform(bot)
                    candidateChannel(bot)
                    // One member per candidate, so each is a separate account in the queue
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/:id`, (request) => ({
                        body: bot.fixtures.member({
                            user: bot.fixtures.user({ id: request.path.split("/")[4] }),
                            joined_at: "1970-01-01T00:00:00Z",
                            communication_disabled_until: null,
                        }),
                    }))
                    // NeonFlux cannot post where the first member leveled up, and the other channels take the message
                    const sends = bot.rest.respond("POST /channels/:id/messages", (request) =>
                        request.path.split("/")[2] === here
                            ? { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Missing permissions" } }
                            : {
                                  body: bot.fixtures.message({
                                      channel_id: request.path.split("/")[2],
                                      author: bot.fixtures.botUser(),
                                  }),
                              },
                    )
                    yield* bot.ready()
                    const processed = yield* Deferred.make<void>()
                    let awards = 0
                    remote.store.preflight = () => Effect.succeed({ eligible: true as const, policyRevision: 1, fence })
                    remote.store.award = () =>
                        Effect.gen(function* () {
                            const levelUp = announced[awards++]
                            if (awards === 3) yield* Deferred.succeed(processed, undefined)
                            return {
                                awarded: true as const,
                                xpAdded: 15,
                                profile: levelProfile(members[awards - 1]!, 900),
                                rewardQueued: false,
                                ...(levelUp ? { levelUp } : {}),
                            }
                        })
                    const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                    const credit = (index: number) =>
                        Effect.gen(function* () {
                            assert.equal(yield* worker.offer(candidate(members[index]!)), true)
                        })
                    yield* credit(0)
                    yield* sends.next()
                    yield* credit(1)
                    yield* sends.next()
                    yield* credit(2)
                    yield* Deferred.await(processed)
                    yield* credit(3)
                    yield* sends.next()
                    assert.deepEqual(
                        sends.requests().map((request) => {
                            const { content, allowed_mentions } = request.body as Record<string, unknown>
                            return [request.path.split("/")[2], { content, allowed_mentions }]
                        }),
                        [here, chosen, later].map((channelId, index) => [
                            channelId,
                            {
                                content: `<@${members[[0, 1, 3][index]!]}> reached level ${[2, 3, 4][index]}`,
                                allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
                            },
                        ]),
                    )
                    assert.equal(awards, 4)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
            { signal: t.signal },
        )
    },
)

test("a queued stale candidate never reaches preflight and failed candidates release their account", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>(),
                    third = yield* Deferred.make<void>()
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                candidateChannel(bot)
                yield* bot.ready()
                const seen: string[] = []
                const remote = levelsBoundary({
                    preflight: (input) =>
                        Effect.gen(function* () {
                            seen.push(input.candidate.userId)
                            if (seen.length === 1) {
                                yield* Deferred.succeed(entered, undefined)
                                yield* Deferred.await(release)
                            } else yield* Deferred.succeed(third, undefined)
                            return { eligible: false as const, reason: "cooldown" as const }
                        }),
                })
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                yield* worker.offer(candidate("1"))
                yield* Deferred.await(entered)
                yield* worker.offer(candidate("2"))
                yield* TestClock.adjust("600001 millis")
                yield* worker.offer(candidate("3", 600001))
                yield* Deferred.succeed(release, undefined)
                yield* Deferred.await(third)
                assert.deepEqual(seen, ["1", "3"])
                assert.equal(yield* worker.offer(candidate("1", 600001)), true)
                assert.equal(
                    remote.calls.some((c) => c.method === "award"),
                    false,
                )
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("a disabled preflight pauses candidates until a leveling change rechecks or ten minutes pass", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const answered = yield* Deferred.make<void>()
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                candidateChannel(bot)
                yield* bot.ready()
                const remote = levelsBoundary({
                    preflight: () =>
                        Deferred.succeed(answered, undefined).pipe(
                            Effect.as({ eligible: false as const, reason: "disabled" as const }),
                        ),
                })
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                assert.equal(yield* worker.wanted, true)
                yield* worker.offer(candidate("1"))
                yield* Deferred.await(answered)
                while (worker.pending()) yield* Effect.yieldNow
                assert.equal(yield* worker.wanted, false)
                // A chat or dashboard change to leveling or a preset rechecks at once
                yield* levelingRechecks.get(f.ids.guild)!()
                assert.equal(yield* worker.wanted, true)
                yield* worker.offer(candidate("2"))
                while (worker.pending()) yield* Effect.yieldNow
                assert.equal(yield* worker.wanted, false)
                yield* TestClock.adjust("599999 millis")
                assert.equal(yield* worker.wanted, false)
                yield* TestClock.adjust("1 millis")
                assert.equal(yield* worker.wanted, true)
                assert.equal(remote.calls.filter((c) => c.method === "preflight").length, 2)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("a disabled answer to a preflight sent before a recheck does not pause candidates again", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>()
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                candidateChannel(bot)
                yield* bot.ready()
                const remote = levelsBoundary({
                    preflight: () =>
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(release)),
                            Effect.as({ eligible: false as const, reason: "disabled" as const }),
                        ),
                })
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                yield* worker.offer(candidate("1"))
                yield* Deferred.await(entered)
                // Leveling is turned on while the older preflight is still waiting for its answer
                yield* levelingRechecks.get(f.ids.guild)!()
                yield* Deferred.succeed(release, undefined)
                while (worker.pending()) yield* Effect.yieldNow
                assert.equal(yield* worker.wanted, true)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("native collection follows successful protection and rejects blocked creates, edits and nonhuman sources", async () => {
    const f = createFixtures()
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "single", serverIds: [f.ids.guild] }
        throw new Error("Unexpected backend request")
    }, quietSignal)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const admitted = yield* Deferred.make<LevelingCandidate>()
                const remote = levelsBoundary({
                    preflight: (input) =>
                        Effect.gen(function* () {
                            yield* Deferred.succeed(admitted, input.candidate)
                            return { eligible: false as const, reason: "disabled" as const }
                        }),
                })
                const moderation = boundary({
                    evaluate: (input) =>
                        Effect.succeed({
                            duplicate: false,
                            blocked: input.content === "Blocked by protection",
                            ...(input.gate ? { gate: moderation.gate(input.gate) } : {}),
                        }),
                })
                moderation.current.automodEnabled = true
                const afk: AfkStore = {
                    set: (userId, reason) => Effect.succeed({ userId, reason, since: 0 }),
                    observe: () => Effect.succeed({ cleared: false, statuses: [] }),
                }
                const responses: ResponseStore = {
                    manage: () => Effect.fail(new ResponseStoreError({ operation: "manage", status: 403 })),
                    evaluate: () => Effect.succeed({ send: false }),
                }
                const bot = yield* createTestBot(
                        createBotOptions(
                            {
                                token,
                                serverId: f.ids.guild,
                                backend: { url: "https://synthetic-test.convex.cloud", secret, client },
                            },
                            {
                                afk,
                                responses,
                                moderation: moderation.store,
                                publishing: publishingBoundary().store,
                                roles: rolesBoundary().store,
                                greetings: greetingsBoundary().store,
                                tickets: ticketBoundary().store,
                                leveling: remote.store,
                            },
                        ),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                const base = { timestamp: "1970-01-01T00:00:00Z" }
                const dm = { ...bot.fixtures.message({ content: "Direct message", channel_id: f.nextId(), ...base }) }
                delete dm.guild_id
                const excluded = [
                    bot.fixtures.message({ content: "Blocked by protection", ...base }),
                    dm,
                    bot.fixtures.message({ content: "Bot message", author: bot.fixtures.botUser(), ...base }),
                    bot.fixtures.message({ content: "Webhook message", webhook_id: f.nextId(), ...base }),
                    bot.fixtures.message({ content: "System message", type: 7, ...base }),
                    bot.fixtures.message({ content: "Other server", guild_id: f.nextId(), ...base }),
                    bot.fixtures.message({ content: "  ", ...base }),
                    bot.fixtures.message({ content: "!ping", ...base }),
                ]
                for (const input of excluded) {
                    yield* bot.emit("MESSAGE_CREATE", input)
                    yield* bot.idle()
                }
                yield* bot.emit(
                    "MESSAGE_UPDATE",
                    bot.fixtures.message({
                        content: "Edited message",
                        edited_timestamp: "1970-01-01T00:00:01Z",
                        ...base,
                    }),
                )
                yield* bot.idle()
                const valid = bot.fixtures.message({ content: "Eligible human create", ...base })
                yield* bot.emit("MESSAGE_CREATE", valid)
                const accepted = yield* Deferred.await(admitted)
                yield* bot.idle()
                assert.equal(accepted.messageId, valid.id)
                assert.equal(remote.calls.filter((c) => c.method === "preflight").length, 1)
                assert.equal(bot.failures().length, 0)
                assert(p.actor.requests().length > 0)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("foreground native message handling completes while XP preflight remains blocked", async () => {
    const f = createFixtures(),
        remote = levelsBoundary()
    let preflights = 0
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "single", serverIds: [f.ids.guild] }
        throw new Error("Unexpected foreground backend request")
    }, quietSignal)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>()
                remote.store.preflight = () =>
                    Effect.gen(function* () {
                        preflights++
                        yield* Deferred.succeed(entered, undefined)
                        yield* Deferred.await(released)
                        return { eligible: false as const, reason: "disabled" as const }
                    })
                const afk: AfkStore = {
                    set: (userId, reason) => Effect.succeed({ userId, reason, since: 0 }),
                    observe: () => Effect.succeed({ cleared: false, statuses: [] }),
                }
                let evaluations = 0
                const responses: ResponseStore = {
                    manage: () => Effect.fail(new ResponseStoreError({ operation: "manage", status: 403 })),
                    evaluate: () =>
                        Effect.sync(() => {
                            evaluations++
                            return { send: false } as const
                        }),
                }
                const options = createBotOptions(
                    {
                        token,
                        serverId: f.ids.guild,
                        backend: { url: "https://synthetic-test.convex.cloud", secret, client },
                    },
                    {
                        afk,
                        responses,
                        moderation: boundary().store,
                        publishing: publishingBoundary().store,
                        roles: rolesBoundary().store,
                        greetings: greetingsBoundary().store,
                        tickets: ticketBoundary().store,
                        leveling: remote.store,
                    },
                )
                const bot = yield* createTestBot(options),
                    p = platform(bot)
                yield* bot.ready()
                yield* bot.emit(
                    "MESSAGE_CREATE",
                    bot.fixtures.message({ content: "Hello from a human", timestamp: "1970-01-01T00:00:00Z" }),
                )
                yield* Deferred.await(entered)
                yield* bot.idle()
                // The unrelated response handler already finished its evaluation. XP is still at preflight.
                assert.equal(evaluations, 1)
                assert.equal(preflights, 1)
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
                yield* p.replies.next()
                yield* bot.idle()
                assert.equal(preflights, 1)
                assert.equal(bot.failures().length, 0)
                yield* Deferred.succeed(released, undefined)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test(
    "forty members in a minute all reach the XP preflight, because XP has no per-server bucket",
    { timeout: 30000 },
    async () => {
        const f = createFixtures()
        const client = fakeClient((call) => {
            if (call.path === "/service/scope") return { mode: "single", serverIds: [f.ids.guild] }
            throw new Error("Unexpected backend request")
        }, quietSignal)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const reached = yield* Deferred.make<void>(),
                        seen = new Set<string>()
                    const remote = levelsBoundary({
                        preflight: (input) =>
                            Effect.gen(function* () {
                                seen.add(input.candidate.userId)
                                if (seen.size === 40) yield* Deferred.succeed(reached, undefined)
                                return { eligible: false as const, reason: "excluded" as const }
                            }),
                    })
                    const moderation = boundary({
                        evaluate: (input) =>
                            Effect.succeed({
                                duplicate: false,
                                blocked: false,
                                ...(input.gate ? { gate: moderation.gate(input.gate) } : {}),
                            }),
                    })
                    moderation.current.automodEnabled = true
                    const afk: AfkStore = {
                        set: (userId, reason) => Effect.succeed({ userId, reason, since: 0 }),
                        observe: () => Effect.succeed({ cleared: false, statuses: [] }),
                    }
                    const responses: ResponseStore = {
                        manage: () => Effect.fail(new ResponseStoreError({ operation: "manage", status: 403 })),
                        evaluate: () => Effect.succeed({ send: false }),
                    }
                    const bot = yield* createTestBot(
                        createBotOptions(
                            {
                                token,
                                serverId: f.ids.guild,
                                backend: { url: "https://synthetic-test.convex.cloud", secret, client },
                            },
                            {
                                afk,
                                responses,
                                moderation: moderation.store,
                                publishing: publishingBoundary().store,
                                roles: rolesBoundary().store,
                                greetings: greetingsBoundary().store,
                                tickets: ticketBoundary().store,
                                leveling: remote.store,
                            },
                        ),
                    )
                    platform(bot)
                    yield* bot.ready()
                    // The clock never moves, so a bucket of 30 would never refill
                    for (let index = 0; index < 40; index++)
                        yield* bot.emit(
                            "MESSAGE_CREATE",
                            bot.fixtures.message({
                                content: `message ${index}`,
                                author: bot.fixtures.user({ id: bot.fixtures.nextId() }),
                                timestamp: "1970-01-01T00:00:00Z",
                            }),
                        )
                    yield* Deferred.await(reached)
                    assert.equal(seen.size, 40)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("a member inside the backend's cooldown is skipped without a preflight until it ends or a leveling change rechecks", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                candidateChannel(bot)
                yield* bot.ready()
                const remote = levelsBoundary({
                    preflight: (input) =>
                        Effect.succeed({
                            eligible: false as const,
                            reason: "cooldown" as const,
                            nextAt: input.candidate.createdAt + 60000,
                        }),
                })
                const preflights = () => remote.calls.filter((c) => c.method === "preflight").length
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                const settle = Effect.gen(function* () {
                    while (worker.pending()) yield* Effect.yieldNow
                })
                assert.equal(yield* worker.offer(candidate("1", 0)), true)
                yield* settle
                assert.equal(preflights(), 1)
                // Another member is unaffected, and so is a message of this member that the cooldown no longer covers
                assert.equal(yield* worker.offer(candidate("2", 0)), true)
                yield* settle
                assert.equal(preflights(), 2)
                assert.equal(yield* worker.offer(candidate("1", 30000)), false)
                assert.equal(preflights(), 2)
                yield* TestClock.adjust("60000 millis")
                assert.equal(yield* worker.offer(candidate("1", 60000)), true)
                yield* settle
                assert.equal(preflights(), 3)
                // A change to leveling forgets every wait
                assert.equal(yield* worker.offer(candidate("1", 60001)), false)
                yield* levelingRechecks.get(f.ids.guild)!()
                assert.equal(yield* worker.offer(candidate("1", 60002)), true)
                yield* settle
                assert.equal(preflights(), 4)
                // A member who deleted their data loses only their own wait
                yield* worker.offer(candidate("2", 60002))
                yield* settle
                assert.equal(yield* worker.offer(candidate("1", 60003)), false)
                levelingForgets.get(f.ids.guild)!("1")
                assert.equal(yield* worker.offer(candidate("2", 60003)), false)
                assert.equal(yield* worker.offer(candidate("1", 60004)), true)
                yield* settle
                assert.equal(preflights(), 6)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("an award starts the member's wait from the backend's answer, and a wait from before a recheck is not kept", async () => {
    const f = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                candidateChannel(bot)
                p.target.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: p.targetId }),
                        joined_at: "1970-01-01T00:00:00Z",
                        communication_disabled_until: null,
                    }),
                })
                yield* bot.ready()
                const entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>()
                let hold = false
                const remote = levelsBoundary({
                    preflight: () => Effect.succeed({ eligible: true as const, policyRevision: 1, fence }),
                    award: (input) =>
                        Effect.gen(function* () {
                            if (hold) {
                                yield* Deferred.succeed(entered, undefined)
                                yield* Deferred.await(release)
                            }
                            return {
                                awarded: true as const,
                                nextAt: input.candidate.createdAt + 60000,
                                xpAdded: 15,
                                profile: { ...levelProfile(p.targetId, 15), fence },
                                rewardQueued: false,
                            }
                        }),
                })
                const worker = yield* startLevelCreditWorker(remote.store, f.ids.guild, bot.client)
                const settle = Effect.gen(function* () {
                    while (worker.pending()) yield* Effect.yieldNow
                })
                const preflights = () => remote.calls.filter((c) => c.method === "preflight").length
                assert.equal(yield* worker.offer(candidate(p.targetId, 0)), true)
                yield* settle
                assert.equal(preflights(), 1)
                assert.equal(yield* worker.offer(candidate(p.targetId, 1000)), false)
                assert.equal(preflights(), 1)
                yield* TestClock.adjust("60000 millis")
                // An award whose answer arrives after a recheck says nothing about the settings that were just applied
                hold = true
                assert.equal(yield* worker.offer(candidate(p.targetId, 60000)), true)
                yield* Deferred.await(entered)
                yield* levelingRechecks.get(f.ids.guild)!()
                yield* Deferred.succeed(release, undefined)
                yield* settle
                hold = false
                assert.equal(yield* worker.offer(candidate(p.targetId, 61000)), true)
                yield* settle
                assert.equal(preflights(), 3)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
