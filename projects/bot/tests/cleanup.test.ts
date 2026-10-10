import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions, snowflakes } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { cleanupSkip, fetchCleanupHistory, fetchCleanupMessage } from "../src/cleanup-evidence.ts"
import { readCleanupContext } from "../src/cleanup-permissions.ts"
import { CleanupStoreError, type CleanupStore } from "../src/cleanup-store.ts"
import { processCleanupTarget } from "../src/cleanup.ts"
import { processCleanupPass } from "../src/cleanup-worker.ts"

const now = Date.parse("2026-10-04T00:00:00Z"), old = now - 2 * 86400000
const nativeMessageId = String(BigInt(snowflakes.boundary(new Date(old))) + 1n)
const counts: C.CleanupCounts = { scanned: 0, skipped: 0, attempted: 0, submitted: 0, acknowledged: 0, observedAbsent: 0, unresolved: 0, failed: 0, cancelled: 0 }
function platform(native: TestClient, options: { actorRaw?: object, timeout?: string | null } = {}) {
    const f = native.fixtures, staff = f.role({ permissions: Permissions.Administrator.toString(), position: 10 }), bot = f.role({ permissions: Permissions.Administrator.toString(), position: 20 })
    const actor = f.user({ bot: false, system: false, ...options.actorRaw })
    native.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
    native.rest.respond(`GET /users/${f.ids.bot}`, { body: f.botUser({ system: false }) })
    native.rest.respond(`GET /users/${f.ids.user}`, { body: actor })
    native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild() })
    native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [f.role({ id: f.ids.guild, permissions: "0" }), staff, bot] })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ user: actor, roles: [staff.id], joined_at: new Date(old - 86400000).toISOString(), communication_disabled_until: options.timeout ?? null }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [bot.id], joined_at: new Date(old - 86400000).toISOString(), communication_disabled_until: null }) })
    native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel() })
    return f.message({ id: nativeMessageId, author: f.user({ bot: false, system: false }), timestamp: new Date(old).toISOString(), content: "Private fixture body never stored" })
}
function boundary(native: TestClient, overrides: Partial<CleanupStore> = {}) {
    const f = native.fixtures
    const policy: C.CleanupPolicy = { channelId: f.ids.channel, revision: 1, enabled: true, ageMs: 86400000, ownerId: f.ids.user, excludedAuthorIds: [], excludedMessageIds: [], nextCheckAt: now }
    const message: C.CleanupMessage = { messageId: nativeMessageId, channelId: f.ids.channel, serverId: f.ids.guild, observedAt: now, createdAt: new Date(old).toISOString(), authorId: f.ids.user, authorBot: false, authorSystem: false, type: 0, pinned: false, webhookId: null }
    const target: C.CleanupTarget = { channelId: f.ids.channel, policyRevision: 1, moduleRevision: 1, sweepNo: 1, pageNo: 1, targetNo: 1, messageId: nativeMessageId, ownerId: f.ids.user, state: "queued", message, createdAt: now, updatedAt: now }
    const grant: C.CleanupGrant = { channelId: target.channelId, policyRevision: 1, moduleRevision: 1, sweepNo: 1, pageNo: 1, targetNo: 1, messageId: nativeMessageId, ownerId: f.ids.user, botId: f.ids.bot, cutoffAt: now - 86400000, createdAt: message.createdAt!, authorId: f.ids.user, dispatchExpiresAt: now + 120000, nativeDeadlineMs: 5000 }
    const settings: C.CleanupSettings = { enabled: true, revision: 1, policies: 1, retainedTargets: 1, retainedSweeps: 1, receipts: 0, targetCapacity: 10000, quotaPaused: false }
    const calls: C.CleanupWorkRequest[] = []
    const store: CleanupStore = {
        manage: () => Effect.succeed({ duplicate: true }),
        query: input => Effect.succeed(input.operation.type === "settings" ? { type: "settings", settings } : input.operation.type === "show" ? { type: "policy", policy } : { type: "preview", cutoffAt: grant.cutoffAt, eligible: 1, skipped: 0, unknown: 0, items: [{ message, disposition: "eligible" }] }),
        work: input => Effect.sync((): C.CleanupWorkResult => { calls.push(input); const op = input.operation
            if (op.type === "reserve") return { type: "reserved", grant }
            if (op.type === "claim") return { type: "claimed", claimed: true, grant }
            if (op.type === "check") return { type: "progress", recorded: true, complete: false }
            if (op.type === "outcome") return { type: "target", recorded: true, target: { ...target, state: op.outcome, ...(op.noDispatch ? { noDispatch: true } : {}) } }
            return { type: "progress", recorded: true, complete: true }
        }), ...overrides,
    }
    return { policy, message, target, grant, settings, store, calls }
}

test("message metadata reads omitted author flags as false and keeps missing pin evidence unknown", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures
        const wire = platform(native)
        Reflect.deleteProperty(wire.author, "bot")
        Reflect.deleteProperty(wire.author, "system")
        Reflect.deleteProperty(wire, "pinned")
        native.rest.respond("GET /channels/:id/messages/:id", { body: wire })
        const result = yield* fetchCleanupMessage(native.client, f.ids.channel, wire.id)
        assert.equal(result.authorBot, false); assert.equal(result.authorSystem, false); assert.equal(result.pinned, null)
        assert.equal("content" in result, false); assert.equal("attachments" in result, false)
        assert.equal(cleanupSkip(result, f.ids.guild, f.ids.channel, now, { excludedAuthorIds: [], excludedMessageIds: [] }), "pin-unknown")
        // Fluxer omits false author flags, so an ordinary unpinned human message stays eligible
        assert.equal(cleanupSkip({ ...result, pinned: false }, f.ids.guild, f.ids.channel, now, { excludedAuthorIds: [], excludedMessageIds: [] }), undefined)
    })))
})
test("history uses the oldest ID across exclusions, short nonempty pages and the public boundary", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures
        const older = platform(native), newer = { ...older, id: String(BigInt(older.id) + 1n), pinned: true }
        const history = native.rest.respond("GET /channels/:id/messages", { body: [newer, older] })
        const before = snowflakes.boundary(new Date(now - 86400000))
        const result = yield* fetchCleanupHistory(native.client, f.ids.guild, f.ids.channel, before)
        assert.equal(result.length, 2); assert.equal(result.at(-1)?.messageId, older.id)
        assert.equal(result[0]?.pinned, true); assert.equal(result[1]?.authorBot, false)
        assert.equal(history.requests().length, 1)
        assert(history.requests().every(r => new URL(r.url).searchParams.get("before") === before && new URL(r.url).searchParams.get("limit") === "50"))
        assert.equal(cleanupSkip({ ...result[1]!, messageId: snowflakes.boundary(new Date(now)), createdAt: new Date(now).toISOString() }, f.ids.guild, f.ids.channel, now, { excludedAuthorIds: [], excludedMessageIds: [] }), "too-new")
    })))
})
test("a deleted message is absent evidence and other read failures stay unknown", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures, wire = platform(native)
        const deleted = native.rest.respond("GET /channels/:id/messages/:id", { status: 404, body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" } })
        const absent = yield* Effect.flip(fetchCleanupMessage(native.client, f.ids.channel, wire.id, f.ids.guild))
        assert.equal(absent._tag === "CleanupEvidenceError" && absent.stage, "absent")
        deleted.remove()
        native.rest.respond("GET /channels/:id/messages/:id", { status: 403, body: { code: "MISSING_ACCESS", message: "Missing Access" } })
        const denied = yield* Effect.flip(fetchCleanupMessage(native.client, f.ids.channel, wire.id, f.ids.guild))
        assert.notEqual(denied._tag === "CleanupEvidenceError" && denied.stage, "absent")
    })))
})
for (const scenario of ["duplicate", "reversed", "wrong-channel", "stalled"] as const) test(`history blocks ${scenario} pages`, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), wire = platform(native), f = native.fixtures
        const next = { ...wire, id: String(BigInt(wire.id) + 1n) }
        native.rest.respond("GET /channels/:id/messages", { body: scenario === "duplicate" ? [wire, wire] : scenario === "reversed" ? [wire, next] : scenario === "wrong-channel" ? [{ ...wire, channel_id: f.nextId() }] : [wire] })
        const result = yield* Effect.exit(fetchCleanupHistory(native.client, f.ids.guild, f.ids.channel, scenario === "stalled" ? wire.id : snowflakes.boundary(new Date(now))))
        assert(Exit.isFailure(result))
    })))
})
test("Cleanup authority accepts documented omitted false user flags with exact native identity", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const native = yield* createTestClient({ logging: { level: "silent" } })
        platform(native, { actorRaw: { bot: undefined, system: undefined } })
        native.rest.respond("GET /users/@me", { body: native.fixtures.botUser({ system: undefined }) })
        const f = native.fixtures, context = yield* readCleanupContext(native.client, f.ids.guild, f.ids.user, f.ids.channel, true)
        assert.equal(context.actorKind, "human"); assert.equal(context.botKind, "bot")
        assert.equal(context.actor.userId, f.ids.user); assert.equal(context.botId, f.ids.bot)
    })).pipe(Effect.provide(TestClock.layer())))
})
for (const [label, raw, timeout] of [["malformed bot flag", { bot: "false" }, null], ["malformed system flag", { system: null }, null], ["system author", { system: true }, null], ["bot author", { bot: true }, null], ["current timeout despite administrator bits", {}, new Date(now + 1000).toISOString()]] as const) test(`automatic authority denies ${label}`, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const native = yield* createTestClient({ logging: { level: "silent" } })
        platform(native, { actorRaw: raw, timeout })
        const f = native.fixtures, result = yield* Effect.exit(readCleanupContext(native.client, f.ids.guild, f.ids.user, f.ids.channel, true))
        assert(Exit.isFailure(result))
    })).pipe(Effect.provide(TestClock.layer())))
})
for (const [label, change, reason] of [
    ["pinned", { pinned: true }, "pinned"], ["unknown pin", { pinned: null }, "pin-unknown"], ["bot", { authorBot: true }, "bot"], ["unknown human", { authorBot: null }, "identity-unknown"], ["system", { type: 7 }, "system"], ["webhook", { webhookId: "123" }, "webhook"], ["mismatched timestamp", { createdAt: new Date(old + 1).toISOString() }, "timestamp-unknown"],
] as const) test(`exact eligibility preserves ${label}`, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), b = boundary(native)
        assert.equal(cleanupSkip({ ...b.message, ...change }, native.fixtures.ids.guild, b.policy.channelId, b.grant.cutoffAt, b.policy), reason)
        assert.equal(cleanupSkip(b.message, native.fixtures.ids.guild, b.policy.channelId, b.grant.cutoffAt, { ...b.policy, excludedAuthorIds: [b.message.authorId!] }), "excluded-author")
        assert.equal(cleanupSkip(b.message, native.fixtures.ids.guild, b.policy.channelId, b.grant.cutoffAt, { ...b.policy, excludedMessageIds: [b.message.messageId] }), "excluded-message")
    })))
})

for (const scenario of ["deleted", "duplicate-claim", "lost-claim", "expired-after-response", "rejected", "timeout"] as const) test(`single delete executor accounts ${scenario} without application replay`, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const native = yield* createTestClient({ logging: { level: "silent" }, rest: { concurrency: 1 } }), f = native.fixtures, wire = platform(native), b = boundary(native)
        native.rest.respond("GET /channels/:id/messages/:id", { body: { ...wire, pinned: false } })
        const entered = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>()
        const deletion = native.rest.respond("DELETE /channels/:id/messages/:id", () => scenario === "timeout" ? Effect.runPromise(Effect.gen(function* () { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); return { status: 204 } })) : { status: scenario === "rejected" ? 403 : 204, ...(scenario === "rejected" ? { body: { code: "MISSING_PERMISSIONS" } } : {}) })
        const base = b.store.work
        b.store.work = input => {
            if (input.operation.type === "claim") {
                b.calls.push(input)
                if (scenario === "lost-claim") return Effect.fail(new CleanupStoreError({ operation: "work", status: null }))
                if (scenario === "expired-after-response") return TestClock.adjust("120 seconds").pipe(Effect.as({ type: "claimed", claimed: true, grant: b.grant } as C.CleanupWorkResult))
                return Effect.succeed({ type: "claimed", claimed: scenario !== "duplicate-claim", grant: b.grant })
            }
            return base(input)
        }
        const fiber = yield* Effect.forkChild(processCleanupTarget(b.store, f.ids.guild, native.client, b.policy, b.target))
        if (scenario === "timeout") { yield* Deferred.await(entered); yield* TestClock.adjust("5 seconds") }
        const result = yield* Fiber.join(fiber)
        assert.equal(deletion.requests().length, ["deleted", "rejected", "timeout"].includes(scenario) ? 1 : 0)
        assert.equal(result.acknowledged, scenario === "deleted")
        if (scenario === "lost-claim" || scenario === "duplicate-claim") assert.equal(b.calls.filter(c => c.operation.type === "outcome").length, 0)
        else {
            const callback = b.calls.find(c => c.operation.type === "outcome")!.operation
            assert.equal(callback.type, "outcome")
            if (callback.type === "outcome") { assert.equal(callback.noDispatch, ["deleted", "rejected", "timeout"].includes(scenario) ? undefined : true); assert.equal(callback.outcome, scenario === "deleted" ? "deleted" : scenario === "timeout" ? "uncertain" : "failed") }
        }
        if (scenario === "timeout") yield* Deferred.succeed(release, undefined)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("durable pass resumes its stored page and honors five per channel and twenty globally", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures, wire = platform(native), b = boundary(native)
        const history = native.rest.respond("GET /channels/:id/messages", { body: [] })
        native.rest.respond("GET /channels/:id/messages/:id", { body: wire })
        const deletion = native.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
        const base = b.store.work
        const policies = Array.from({ length: 5 }, (_, index) => ({ ...b.policy, channelId: index ? f.nextId() : f.ids.channel }))
        for (const p of policies.slice(1)) native.rest.respond(`GET /channels/${p.channelId}`, { body: f.channel({ id: p.channelId }) })
        native.rest.respond("GET /channels/:id/messages/:id", request => ({ body: { ...wire, channel_id: request.path.split("/")[2], id: request.path.split("/").at(-1) } }))
        const policyByChannel = new Map(policies.map(p => [p.channelId, p]))
        const nativeGrant = (binding: C.CleanupTargetBinding): C.CleanupGrant => ({ ...b.grant, ...binding })
        b.store.query = input => Effect.succeed(input.operation.type === "settings" ? { type: "settings", settings: b.settings } : { type: "policy", policy: policyByChannel.get(input.context.channelId)! })
        b.store.work = input => {
            const op = input.operation
            if (op.type === "list") return Effect.succeed({ type: "policies", policies, settings: b.settings, hasMore: true, nextCursor: { cursor: "synthetic_next", throughAt: now } })
            if (op.type === "start") return Effect.succeed({ type: "sweep", sweep: { channelId: op.channelId, policyRevision: 1, moduleRevision: 1, sweepNo: 1, ownerId: f.ids.user, cutoffAt: b.grant.cutoffAt, before: snowflakes.boundary(new Date(now)), pageNo: 1, state: "active", counts, createdAt: now, updatedAt: now },
                page: { channelId: op.channelId, policyRevision: 1, moduleRevision: 1, sweepNo: 1, pageNo: 1, before: snowflakes.boundary(new Date(now)), nextBefore: wire.id, empty: false, items: [], persistedAt: now }, targets: Array.from({ length: 6 }, (_, index) => {
                    const targetNo = policies.findIndex(p => p.channelId === op.channelId) * 6 + index + 1, messageId = String(BigInt(nativeMessageId) + BigInt(targetNo))
                    return { ...b.target, targetNo, messageId, channelId: op.channelId, message: { ...b.message, messageId, channelId: op.channelId } }
                }) })
            if (op.type === "reserve") return Effect.succeed({ type: "reserved", grant: nativeGrant(op.binding) })
            if (op.type === "claim") return Effect.succeed({ type: "claimed", claimed: true, grant: nativeGrant(op.binding) })
            return base(input)
        }
        const result = yield* processCleanupPass(b.store, f.ids.guild, native.client)
        assert.equal(result.considered, 4); assert.equal(result.attempted, 20)
        assert.equal(history.requests().length, 0)
        assert.equal(deletion.requests().length, 20)
        for (const p of policies.slice(0, 4)) assert.equal(deletion.requests().filter(r => r.path.split("/")[2] === p.channelId).length, 5)
        assert.equal(deletion.requests().filter(r => r.path.split("/")[2] === policies[4]!.channelId).length, 0)
        assert.equal(result.hasMore, true); assert.equal(result.nextCursor, undefined)
    })).pipe(Effect.provide(TestClock.layer())))
})
