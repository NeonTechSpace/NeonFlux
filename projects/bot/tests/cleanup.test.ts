import type {
    CleanupCounts,
    CleanupPolicy,
    CleanupMessage,
    CleanupTarget,
    CleanupGrant,
    CleanupSettings,
    CleanupWorkRequest,
    CleanupWorkResult,
} from "@neonflux/contracts/cleanup"
import assert from "node:assert/strict"
import test from "node:test"

import { Permissions, snowflakes } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { fetchCleanupHistory, fetchCleanupMessage } from "../src/cleanup-evidence.ts"
import { readCleanupContext } from "../src/cleanup-permissions.ts"
import { CleanupStoreError, type CleanupStore } from "../src/cleanup-store.ts"
import { processCleanupBatch, processCleanupTarget } from "../src/cleanup.ts"
import { cleanupChannelBudget, cleanupPassBudget, processCleanupPass } from "../src/cleanup-worker.ts"

const now = Date.parse("2026-10-04T00:00:00Z"),
    old = now - 2 * 86400000
const nativeMessageId = String(BigInt(snowflakes.boundary(new Date(old))) + 1n)
const counts: CleanupCounts = {
    scanned: 0,
    skipped: 0,
    attempted: 0,
    submitted: 0,
    acknowledged: 0,
    observedAbsent: 0,
    unresolved: 0,
    failed: 0,
    cancelled: 0,
}
function platform(native: TestClient, options: { actorRaw?: object; timeout?: string | null } = {}) {
    const f = native.fixtures,
        staff = f.role({ permissions: Permissions.Administrator.toString(), position: 10 }),
        bot = f.role({ permissions: Permissions.Administrator.toString(), position: 20 })
    const actor = f.user({ bot: false, system: false, ...options.actorRaw })
    native.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
    native.rest.respond(`GET /users/${f.ids.bot}`, { body: f.botUser({ system: false }) })
    native.rest.respond(`GET /users/${f.ids.user}`, { body: actor })
    native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild() })
    native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, {
        body: [f.role({ id: f.ids.guild, permissions: "0" }), staff, bot],
    })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, {
        body: f.member({
            user: actor,
            roles: [staff.id],
            joined_at: new Date(old - 86400000).toISOString(),
            communication_disabled_until: options.timeout ?? null,
        }),
    })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, {
        body: f.member({
            user: f.botUser(),
            roles: [bot.id],
            joined_at: new Date(old - 86400000).toISOString(),
            communication_disabled_until: null,
        }),
    })
    native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel() })
    return f.message({
        id: nativeMessageId,
        author: f.user({ bot: false, system: false }),
        timestamp: new Date(old).toISOString(),
        content: "Private fixture body never stored",
    })
}
function boundary(native: TestClient, overrides: Partial<CleanupStore> = {}) {
    const f = native.fixtures
    const policy: CleanupPolicy = {
        channelId: f.ids.channel,
        revision: 1,
        enabled: true,
        ageMs: 86400000,
        ownerId: f.ids.user,
        excludedAuthorIds: [],
        excludedMessageIds: [],
        nextCheckAt: now,
    }
    const message: CleanupMessage = {
        messageId: nativeMessageId,
        channelId: f.ids.channel,
        serverId: f.ids.guild,
        observedAt: now,
        createdAt: new Date(old).toISOString(),
        authorId: f.ids.user,
        authorBot: false,
        authorSystem: false,
        type: 0,
        pinned: false,
        webhookId: null,
    }
    const target: CleanupTarget = {
        channelId: f.ids.channel,
        policyRevision: 1,
        moduleRevision: 1,
        sweepNo: 1,
        pageNo: 1,
        targetNo: 1,
        messageId: nativeMessageId,
        ownerId: f.ids.user,
        state: "queued",
        message,
        createdAt: now,
        updatedAt: now,
    }
    const grant: CleanupGrant = {
        channelId: target.channelId,
        policyRevision: 1,
        moduleRevision: 1,
        sweepNo: 1,
        pageNo: 1,
        targetNo: 1,
        messageId: nativeMessageId,
        ownerId: f.ids.user,
        botId: f.ids.bot,
        cutoffAt: now - 86400000,
        createdAt: message.createdAt!,
        authorId: f.ids.user,
        dispatchExpiresAt: now + 120000,
        nativeDeadlineMs: 5000,
    }
    const settings: CleanupSettings = {
        enabled: true,
        revision: 1,
        policies: 1,
        receipts: 0,
    }
    const calls: CleanupWorkRequest[] = []
    const store: CleanupStore = {
        manage: () => Effect.succeed({ duplicate: true }),
        query: (input) =>
            Effect.succeed(
                input.operation.type === "settings"
                    ? { type: "settings", settings }
                    : input.operation.type === "show"
                      ? { type: "policy", policy }
                      : {
                            type: "preview",
                            cutoffAt: grant.cutoffAt,
                            eligible: 1,
                            skipped: 0,
                            unknown: 0,
                            items: [{ message, disposition: "eligible" }],
                        },
            ),
        work: (input) =>
            Effect.sync((): CleanupWorkResult => {
                calls.push(input)
                const op = input.operation
                if (op.type === "claim") return { type: "claimed", claimed: true, grant }
                if (op.type === "outcome")
                    return {
                        type: "target",
                        recorded: true,
                        target: { ...target, state: op.outcome, ...(op.noDispatch ? { noDispatch: true } : {}) },
                    }
                return { type: "progress", recorded: true, complete: true }
            }),
        ...overrides,
    }
    return { policy, message, target, grant, settings, store, calls }
}

test("message metadata reads omitted author flags as false and keeps missing pin evidence unknown", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures
                const wire = platform(native)
                Reflect.deleteProperty(wire.author, "bot")
                Reflect.deleteProperty(wire.author, "system")
                Reflect.deleteProperty(wire, "pinned")
                native.rest.respond("GET /channels/:id/messages/:id", { body: wire })
                const result = yield* fetchCleanupMessage(native.client, f.ids.channel, wire.id)
                assert.equal(result.authorBot, false)
                assert.equal(result.authorSystem, false)
                assert.equal(result.pinned, null)
                assert.equal("content" in result, false)
                assert.equal("attachments" in result, false)
            }),
        ),
    )
})
test("history uses the oldest ID across exclusions, short nonempty pages and the public boundary", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures
                const older = platform(native),
                    newer = { ...older, id: String(BigInt(older.id) + 1n), pinned: true }
                const history = native.rest.respond("GET /channels/:id/messages", { body: [newer, older] })
                const before = snowflakes.boundary(new Date(now - 86400000))
                const result = yield* fetchCleanupHistory(native.client, f.ids.guild, f.ids.channel, before)
                assert.equal(result.length, 2)
                assert.equal(result.at(-1)?.messageId, older.id)
                assert.equal(result[0]?.pinned, true)
                assert.equal(result[1]?.authorBot, false)
                assert.equal(history.requests().length, 1)
                assert(
                    history
                        .requests()
                        .every(
                            (r) =>
                                new URL(r.url).searchParams.get("before") === before &&
                                new URL(r.url).searchParams.get("limit") === "50",
                        ),
                )
            }),
        ),
    )
})
test("a deleted message is absent evidence and other read failures stay unknown", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures,
                    wire = platform(native)
                const deleted = native.rest.respond("GET /channels/:id/messages/:id", {
                    status: 404,
                    body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" },
                })
                const absent = yield* Effect.flip(
                    fetchCleanupMessage(native.client, f.ids.channel, wire.id, f.ids.guild),
                )
                assert.equal(absent._tag === "CleanupEvidenceError" && absent.stage, "absent")
                deleted.remove()
                native.rest.respond("GET /channels/:id/messages/:id", {
                    status: 403,
                    body: { code: "MISSING_ACCESS", message: "Missing Access" },
                })
                const denied = yield* Effect.flip(
                    fetchCleanupMessage(native.client, f.ids.channel, wire.id, f.ids.guild),
                )
                assert.notEqual(denied._tag === "CleanupEvidenceError" && denied.stage, "absent")
            }),
        ),
    )
})
for (const scenario of ["duplicate", "reversed", "wrong-channel", "stalled"] as const)
    test(`history blocks ${scenario} pages`, async () => {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const native = yield* createTestClient({ logging: { level: "silent" } }),
                        wire = platform(native),
                        f = native.fixtures
                    const next = { ...wire, id: String(BigInt(wire.id) + 1n) }
                    native.rest.respond("GET /channels/:id/messages", {
                        body:
                            scenario === "duplicate"
                                ? [wire, wire]
                                : scenario === "reversed"
                                  ? [wire, next]
                                  : scenario === "wrong-channel"
                                    ? [{ ...wire, channel_id: f.nextId() }]
                                    : [wire],
                    })
                    const result = yield* Effect.exit(
                        fetchCleanupHistory(
                            native.client,
                            f.ids.guild,
                            f.ids.channel,
                            scenario === "stalled" ? wire.id : snowflakes.boundary(new Date(now)),
                        ),
                    )
                    assert(Exit.isFailure(result))
                }),
            ),
        )
    })
test("Cleanup authority accepts documented omitted false user flags with exact native identity", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                yield* TestClock.setTime(now)
                const native = yield* createTestClient({ logging: { level: "silent" } })
                platform(native, { actorRaw: { bot: undefined, system: undefined } })
                native.rest.respond("GET /users/@me", { body: native.fixtures.botUser({ system: undefined }) })
                const f = native.fixtures,
                    context = yield* readCleanupContext(native.client, f.ids.guild, f.ids.user, f.ids.channel, true)
                assert.equal(context.actorKind, "human")
                assert.equal(context.botKind, "bot")
                assert.equal(context.actor.userId, f.ids.user)
                assert.equal(context.botId, f.ids.bot)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
for (const [label, raw, timeout] of [
    ["malformed bot flag", { bot: "false" }, null],
    ["malformed system flag", { system: null }, null],
    ["system author", { system: true }, null],
    ["bot author", { bot: true }, null],
    ["current timeout despite administrator bits", {}, new Date(now + 1000).toISOString()],
] as const)
    test(`automatic authority denies ${label}`, async () => {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    yield* TestClock.setTime(now)
                    const native = yield* createTestClient({ logging: { level: "silent" } })
                    platform(native, { actorRaw: raw, timeout })
                    const f = native.fixtures,
                        result = yield* Effect.exit(
                            readCleanupContext(native.client, f.ids.guild, f.ids.user, f.ids.channel, true),
                        )
                    assert(Exit.isFailure(result))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    })
for (const scenario of [
    "deleted",
    "duplicate-claim",
    "lost-claim",
    "expired-after-response",
    "rejected",
    "timeout",
    "closed",
] as const)
    test(`single delete executor accounts ${scenario} without application replay`, async () => {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    yield* TestClock.setTime(now)
                    const native = yield* createTestClient({ logging: { level: "silent" }, rest: { concurrency: 1 } }),
                        f = native.fixtures,
                        wire = platform(native),
                        b = boundary(native)
                    native.rest.respond("GET /channels/:id/messages/:id", { body: { ...wire, pinned: false } })
                    const entered = Deferred.makeUnsafe<void>(),
                        release = Deferred.makeUnsafe<void>()
                    const deletion = native.rest.respond("DELETE /channels/:id/messages/:id", () =>
                        scenario === "timeout"
                            ? Effect.runPromise(
                                  Effect.gen(function* () {
                                      yield* Deferred.succeed(entered, undefined)
                                      yield* Deferred.await(release)
                                      return { status: 204 }
                                  }),
                              )
                            : {
                                  status: scenario === "rejected" ? 403 : 204,
                                  ...(scenario === "rejected" ? { body: { code: "MISSING_PERMISSIONS" } } : {}),
                              },
                    )
                    const base = b.store.work
                    b.store.work = (input) => {
                        if (input.operation.type === "claim") {
                            b.calls.push(input)
                            if (scenario === "lost-claim")
                                return Effect.fail(new CleanupStoreError({ operation: "work", status: null }))
                            if (scenario === "expired-after-response")
                                return TestClock.adjust("120 seconds").pipe(
                                    Effect.as({ type: "claimed", claimed: true, grant: b.grant } as CleanupWorkResult),
                                )
                            const claimed = Effect.succeed({
                                type: "claimed",
                                claimed: scenario !== "duplicate-claim",
                                grant: b.grant,
                            } as CleanupWorkResult)
                            // A client that closes before the delete leaves the request unsent
                            return scenario === "closed" ? Effect.andThen(native.client.shutdown(), claimed) : claimed
                        }
                        return base(input)
                    }
                    const fiber = yield* Effect.forkChild(
                        processCleanupTarget(b.store, f.ids.guild, native.client, b.policy, b.target),
                    )
                    if (scenario === "timeout") {
                        yield* Deferred.await(entered)
                        yield* TestClock.adjust("5 seconds")
                    }
                    const result = yield* Fiber.join(fiber)
                    assert.equal(
                        deletion.requests().length,
                        ["deleted", "rejected", "timeout"].includes(scenario) ? 1 : 0,
                    )
                    assert.equal(result.acknowledged, scenario === "deleted")
                    if (scenario === "lost-claim" || scenario === "duplicate-claim")
                        assert.equal(b.calls.filter((c) => c.operation.type === "outcome").length, 0)
                    else {
                        const callback = b.calls.find((c) => c.operation.type === "outcome")!.operation
                        assert.equal(callback.type, "outcome")
                        if (callback.type === "outcome") {
                            assert.equal(
                                callback.noDispatch,
                                ["deleted", "rejected", "timeout"].includes(scenario) ? undefined : true,
                            )
                            assert.equal(
                                callback.outcome,
                                scenario === "deleted" ? "deleted" : scenario === "timeout" ? "uncertain" : "failed",
                            )
                        }
                    }
                    if (scenario === "timeout") yield* Deferred.succeed(release, undefined)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    })
// Targets of one page, with message facts read at the time the test clock stands at
function pageTargets(
    b: ReturnType<typeof boundary>,
    channelId: string,
    first: number,
    count: number,
    observedAt = now,
) {
    return Array.from({ length: count }, (_, index): CleanupTarget => {
        const targetNo = first + index,
            messageId = String(BigInt(nativeMessageId) + BigInt(targetNo))
        return {
            ...b.target,
            channelId,
            targetNo,
            messageId,
            message: { ...b.message, messageId, channelId, observedAt },
        }
    })
}
const grantFor = (b: ReturnType<typeof boundary>, target: CleanupTarget): CleanupGrant => ({
    ...b.grant,
    channelId: target.channelId,
    targetNo: target.targetNo,
    messageId: target.messageId,
})
const bulkIds = (request: { body?: unknown }) => (request.body as { message_ids: string[] }).message_ids

for (const scenario of [
    "deleted",
    "duplicate-claim",
    "foreign-grant",
    "lost-claim",
    "expired-after-response",
    "rejected",
    "timeout",
    "closed",
] as const)
    test(`bulk delete executor accounts ${scenario} without application replay`, async () => {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    yield* TestClock.setTime(now)
                    const native = yield* createTestClient({ logging: { level: "silent" }, rest: { concurrency: 1 } }),
                        f = native.fixtures
                    platform(native)
                    const b = boundary(native),
                        targets = pageTargets(b, f.ids.channel, 1, 3)
                    const entered = Deferred.makeUnsafe<void>(),
                        release = Deferred.makeUnsafe<void>()
                    const deletion = native.rest.respond("POST /channels/:id/messages/bulk-delete", () =>
                        scenario === "timeout"
                            ? Effect.runPromise(
                                  Effect.gen(function* () {
                                      yield* Deferred.succeed(entered, undefined)
                                      yield* Deferred.await(release)
                                      return { status: 204 }
                                  }),
                              )
                            : {
                                  status: scenario === "rejected" ? 403 : 204,
                                  ...(scenario === "rejected" ? { body: { code: "MISSING_PERMISSIONS" } } : {}),
                              },
                    )
                    b.store.work = (input) => {
                        const op = input.operation
                        b.calls.push(input)
                        if (op.type === "outcome-batch")
                            return Effect.succeed({ type: "outcome-batch", recorded: op.bindings.length })
                        if (op.type !== "claim-batch")
                            return Effect.fail(new CleanupStoreError({ operation: "work", status: 404 }))
                        if (scenario === "lost-claim")
                            return Effect.fail(new CleanupStoreError({ operation: "work", status: null }))
                        const claimed = Effect.succeed({
                            type: "claimed-batch",
                            // A grant for a target that was not asked for never gets a delete
                            grants:
                                scenario === "duplicate-claim"
                                    ? []
                                    : scenario === "foreign-grant"
                                      ? [grantFor(b, pageTargets(b, f.ids.channel, 50, 1)[0]!)]
                                      : targets.map((target) => grantFor(b, target)),
                        } as CleanupWorkResult)
                        if (scenario === "expired-after-response")
                            return TestClock.adjust("120 seconds").pipe(Effect.andThen(claimed))
                        // A client that closes before the delete leaves the request unsent
                        return scenario === "closed" ? Effect.andThen(native.client.shutdown(), claimed) : claimed
                    }
                    const fiber = yield* Effect.forkChild(
                        processCleanupBatch(b.store, f.ids.guild, native.client, b.policy, targets),
                    )
                    if (scenario === "timeout") {
                        yield* Deferred.await(entered)
                        yield* TestClock.adjust("5 seconds")
                    }
                    const result = yield* Fiber.join(fiber)
                    const sent = ["deleted", "rejected", "timeout"].includes(scenario)
                    // One request names every claimed message, whatever its answer
                    assert.equal(deletion.requests().length, sent ? 1 : 0)
                    if (sent)
                        assert.deepEqual(
                            bulkIds(deletion.requests()[0]!),
                            targets.map((t) => t.messageId),
                        )
                    assert.equal(result.acknowledged, scenario === "deleted" ? 3 : 0)
                    assert.equal(b.calls.filter((c) => c.operation.type === "claim-batch").length, 1)
                    const recorded = b.calls.filter((c) => c.operation.type === "outcome-batch")
                    if (scenario === "lost-claim" || scenario === "duplicate-claim" || scenario === "foreign-grant") {
                        // Nothing is recorded for a claim the bot does not know it holds, or holds none of
                        assert.equal(recorded.length, 0)
                        assert.equal(result.unresolved, scenario === "duplicate-claim" ? 0 : 3)
                    } else {
                        assert.equal(recorded.length, 1)
                        const callback = recorded[0]!.operation
                        assert.equal(callback.type, "outcome-batch")
                        if (callback.type === "outcome-batch") {
                            assert.equal(callback.bindings.length, 3)
                            assert.match(callback.claimToken, /^[a-f0-9]{32}$/)
                            assert.equal(callback.noDispatch, sent ? undefined : true)
                            assert.equal(
                                callback.outcome,
                                scenario === "deleted" ? "deleted" : scenario === "timeout" ? "uncertain" : "failed",
                            )
                        }
                    }
                    if (scenario === "timeout") yield* Deferred.succeed(release, undefined)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    })

// A fake backend that keeps paging a channel: each page holds fifty targets read at the time of the pass
function pagedBackend(
    b: ReturnType<typeof boundary>,
    policies: CleanupPolicy[],
    options: { oldTargets?: number } = {},
) {
    const pages = new Map<string, number>(),
        advanced: string[] = [],
        outcomes: Extract<CleanupWorkRequest["operation"], { type: "outcome-batch" }>[] = []
    let targetNo = 0
    const sweepFor = (channelId: string) => ({
        channelId,
        policyRevision: 1,
        moduleRevision: 1,
        sweepNo: 1,
        ownerId: b.policy.ownerId,
        cutoffAt: b.grant.cutoffAt,
        before: snowflakes.boundary(new Date(now)),
        pageNo: (pages.get(channelId) ?? 0) + 1,
        state: "active" as const,
        counts,
        createdAt: now,
        updatedAt: now,
    })
    b.store.work = (input) => {
        const op = input.operation
        b.calls.push(input)
        if (op.type === "list")
            return Effect.succeed({
                type: "policies",
                policies,
                settings: b.settings,
                hasMore: true,
                nextCursor: { cursor: "synthetic_next", throughAt: now },
            })
        if (op.type === "start")
            return Effect.succeed({ type: "sweep", sweep: sweepFor(op.channelId), page: null, targets: [] })
        if (op.type === "page") {
            const channelId = op.binding.channelId,
                pageNo = (pages.get(channelId) ?? 0) + 1
            pages.set(channelId, pageNo)
            const targets = [
                ...pageTargets(b, channelId, targetNo + 1, options.oldTargets ?? 0, now - 51000),
                ...pageTargets(b, channelId, targetNo + 1 + (options.oldTargets ?? 0), 50 - (options.oldTargets ?? 0)),
            ]
            targetNo += 50
            return Effect.succeed({
                type: "page",
                page: {
                    ...op.binding,
                    pageNo,
                    before: op.before,
                    nextBefore: targets.at(-1)!.messageId,
                    empty: false,
                    items: [],
                    persistedAt: now,
                },
                targets,
            })
        }
        if (op.type === "claim-batch")
            return Effect.succeed({
                type: "claimed-batch",
                grants: op.items.map((item) => ({
                    ...b.grant,
                    ...item.binding,
                    createdAt: item.message.createdAt!,
                })),
            })
        if (op.type === "outcome-batch") {
            outcomes.push(op)
            return Effect.succeed({ type: "outcome-batch", recorded: op.bindings.length })
        }
        if (op.type === "claim")
            return Effect.succeed({ type: "claimed", claimed: true, grant: { ...b.grant, ...op.binding } })
        if (op.type === "outcome")
            return Effect.succeed({ type: "target", recorded: true, target: { ...b.target, state: op.outcome } })
        if (op.type === "advance") {
            advanced.push(op.binding.channelId)
            return Effect.succeed({ type: "progress", recorded: true, complete: false })
        }
        return Effect.succeed({ type: "progress", recorded: true, complete: true })
    }
    return { pages, advanced, outcomes }
}

test("a pass deletes each page with one bulk request, ten pages per channel and twenty in all", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                yield* TestClock.setTime(now)
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures
                platform(native)
                const b = boundary(native)
                const history = native.rest.respond("GET /channels/:id/messages", { body: [] })
                const reads = native.rest.respond("GET /channels/:id/messages/:id", { body: {} })
                const single = native.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
                const bulk = native.rest.respond("POST /channels/:id/messages/bulk-delete", { status: 204 })
                const policies = Array.from({ length: 5 }, (_, index) => ({
                    ...b.policy,
                    channelId: index ? f.nextId() : f.ids.channel,
                }))
                for (const p of policies.slice(1))
                    native.rest.respond(`GET /channels/${p.channelId}`, { body: f.channel({ id: p.channelId }) })
                const backend = pagedBackend(b, policies)
                assert.equal(cleanupChannelBudget, 10)
                assert.equal(cleanupPassBudget, 20)
                const result = yield* processCleanupPass(b.store, f.ids.guild, native.client)
                assert.equal(result.considered, 2)
                assert.equal(result.attempted, 1000)
                assert.equal(result.acknowledged, 1000)
                assert.equal(history.requests().length, 20)
                // One bulk request of fifty IDs per page, no single deletes and no read of each message
                assert.equal(bulk.requests().length, 20)
                assert(bulk.requests().every((request) => bulkIds(request).length === 50))
                assert.equal(single.requests().length, 0)
                assert.equal(reads.requests().length, 0)
                for (const p of policies.slice(0, 2))
                    assert.equal(bulk.requests().filter((r) => r.path.split("/")[2] === p.channelId).length, 10)
                for (const p of policies.slice(2))
                    assert.equal(bulk.requests().filter((r) => r.path.split("/")[2] === p.channelId).length, 0)
                assert.equal(backend.advanced.length, 20)
                // The channels with pages left are due again at once, so the pass asks for another one
                assert.equal(result.hasMore, true)
                assert.equal(result.nextCursor, undefined)
                assert.equal(new Set(bulk.requests().flatMap(bulkIds)).size, 1000)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("a page whose bulk delete is refused ends the channel's turn after that page", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                yield* TestClock.setTime(now)
                const native = yield* createTestClient({ logging: { level: "silent" } })
                platform(native)
                const b = boundary(native)
                native.rest.respond("GET /channels/:id/messages", { body: [] })
                const bulk = native.rest.respond("POST /channels/:id/messages/bulk-delete", {
                    status: 403,
                    body: { code: "MISSING_PERMISSIONS" },
                })
                const backend = pagedBackend(b, [b.policy])
                const result = yield* processCleanupPass(b.store, native.fixtures.ids.guild, native.client)
                assert.equal(bulk.requests().length, 1)
                assert.equal(backend.advanced.length, 1)
                assert.equal(backend.outcomes[0]!.outcome, "failed")
                assert.equal(result.acknowledged, 0)
                assert.equal(result.unresolved, 50)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("saved targets whose message facts are over fifty seconds old are read and deleted one by one, and the rest of the page is not", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                yield* TestClock.setTime(now)
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    wire = platform(native)
                const b = boundary(native)
                native.rest.respond("GET /channels/:id/messages", { body: [] })
                const reads = native.rest.respond("GET /channels/:id/messages/:id", (request) => ({
                    body: { ...wire, id: request.path.split("/").at(-1) },
                }))
                const single = native.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
                const bulk = native.rest.respond("POST /channels/:id/messages/bulk-delete", { status: 204 })
                // Twenty targets were saved by an earlier pass, so the backend returns them with their old message facts
                const backend = pagedBackend(b, [b.policy], { oldTargets: 20 })
                const work = b.store.work
                let starts = 0
                b.store.work = (input) =>
                    input.operation.type === "start" && ++starts > 1
                        ? Effect.fail(new CleanupStoreError({ operation: "work", status: null }))
                        : work(input)
                const old = yield* processCleanupPass(b.store, native.fixtures.ids.guild, native.client)
                assert.equal(old.attempted, 50)
                assert.equal(old.acknowledged, 50)
                assert.equal(single.requests().length, 20)
                assert.equal(reads.requests().length, 20)
                assert.equal(bulk.requests().length, 1)
                assert.equal(bulkIds(bulk.requests()[0]!).length, 30)
                assert.equal(backend.outcomes.length, 1)
                assert.equal(backend.outcomes[0]!.bindings.length, 30)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
