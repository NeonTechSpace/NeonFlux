import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Clock, Deferred } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processLevelAccount, startLevelRoleWorker } from "../src/level-worker.ts"
import { LevelingStoreError } from "../src/level-store.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { levelsBoundary } from "./level-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"
import { token } from "./moderation-fixture.ts"

const acknowledgment: C.RolesAcknowledgment = { acknowledged: false, accessConfirmed: false, accessRolePresent: false }
const account = (userId: string, roleIds: string[], refs: C.LevelingRewardAccount["refs"] = [], mark = 3): C.LevelingRewardAccount =>
    ({ userId, mark, refs, targets: roleIds.map(roleId => ({ roleId, sourceId: `level_synthetic_profile_${mark}_${roleId}` })), complete: true })
const operations = (calls: { method: string, input: unknown }[], type: C.LevelingWorkRequest["operation"]["type"]) =>
    calls.filter(c => c.method === "work").map(c => (c.input as C.LevelingWorkRequest).operation).filter(op => op.type === type)

test("account reconciliation applies settled roles through the existing native executor and keeps a blocked account dirty", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        const remote = levelsBoundary({ work: () => Effect.succeed({ type: "progress", recorded: true }) })
        let evaluated = 0
        roles.store.evaluate = input => Effect.sync(() => {
            if (input.operation.type !== "level-sync") throw new Error("Expected level-sync")
            evaluated++
            if (input.operation.roleId === p.role.id) return { duplicate: false, status: "blocked", acknowledgment }
            const grant: C.RolesGrant = { attemptId: "synthetic_level_attempt", ownershipId: "synthetic_owner", generation: 1, sourceId: input.sourceId,
                action: "add", userId: p.targetId, joinedAt: input.context.joinedAt, roleId: p.second.id, botId: f.ids.bot, expectedPresent: false,
                consumerKey: "level", dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 }
            roles.attempts.set(grant.attemptId, { ...grant, createdAt: 0, outcome: "pending" })
            return { duplicate: false, status: "reserved", acknowledgment, grant }
        })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, account(p.targetId, [p.role.id, p.second.id]))
        assert.equal(evaluated, 2)
        assert.equal(p.add.requests().length, 1)
        assert(p.roleIds.has(p.second.id))
        assert.deepEqual(operations(remote.calls, "done"), [{ type: "done", userId: p.targetId, mark: 3, complete: false }])
        roles.store.evaluate = () => Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, account(p.targetId, [p.role.id], [], 4))
        assert.deepEqual(operations(remote.calls, "done").at(-1), { type: "done", userId: p.targetId, mark: 4, complete: true })
    })).pipe(Effect.provide(TestClock.layer())))
})

test("one rejected reward target keeps the account dirty and still evaluates later targets", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        const remote = levelsBoundary({ work: () => Effect.succeed({ type: "progress", recorded: true }) })
        const evaluated: string[] = []
        roles.store.evaluate = input => input.operation.type === "level-sync" && (evaluated.push(input.operation.roleId), input.operation.roleId === p.role.id)
            ? Effect.fail(new RolesStoreError({ operation: "evaluate", status: 403 }))
            : Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, account(p.targetId, [p.role.id, p.second.id]))
        assert.deepEqual(evaluated, [p.role.id, p.second.id])
        assert.deepEqual(operations(remote.calls, "done"), [{ type: "done", userId: p.targetId, mark: 3, complete: false }])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("backend dispatch refusal fences a reward without native mutation and keeps the account dirty", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        const remote = levelsBoundary({ work: () => Effect.succeed({ type: "progress", recorded: true }) })
        roles.store.evaluate = input => Effect.succeed({ duplicate: false, status: "reserved", acknowledgment, grant: { attemptId: "synthetic_fenced", ownershipId: "synthetic_owner", generation: 1,
            sourceId: input.sourceId, action: "add", userId: p.targetId, joinedAt: input.context.joinedAt, roleId: p.role.id, botId: f.ids.bot,
            expectedPresent: false, consumerKey: "level", dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 } })
        roles.store.dispatch = () => Effect.succeed({ claimed: false, dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, account(p.targetId, [p.role.id]))
        assert.equal(p.add.requests().length, 0); assert.equal(p.remove.requests().length, 0)
        assert.deepEqual(operations(remote.calls, "done"), [{ type: "done", userId: p.targetId, mark: 3, complete: false }])
        assert.equal(roles.calls.filter(c => c.method === "outcome").length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("reward work skips only typed absent or different raw membership epochs and defers rejected reads", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        const remote = levelsBoundary({ work: () => Effect.succeed({ type: "progress", recorded: true }) })
        const departed = account(p.targetId, [], [{ roleId: p.role.id, joinedAt: "2020-01-01T00:00:00Z" }])
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, departed)
        const changedEpoch = operations(remote.calls, "skip")[0]
        assert.equal(changedEpoch?.type, "skip")
        if (changedEpoch?.type === "skip") { assert.equal(changedEpoch.joinedAt, "2020-01-01T00:00:00Z") }
        assert.deepEqual(operations(remote.calls, "done").at(-1), { type: "done", userId: p.targetId, mark: 3, complete: true })
        p.target.remove()
        const absent = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, departed)
        const skip = (remote.calls.at(-2)!.input as C.LevelingWorkRequest).operation
        assert.equal(skip.type, "skip"); if (skip.type === "skip") { assert.equal(skip.currentJoinedAt, null); assert.equal(skip.memberAbsent, true) }
        absent.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { status: 403, body: { message: "Synthetic denied" } })
        yield* processLevelAccount(remote.store, roles.store, f.ids.guild, bot.client, departed)
        assert.deepEqual(operations(remote.calls, "done").at(-1), { type: "done", userId: p.targetId, mark: 3, complete: false })
        assert.equal(operations(remote.calls, "skip").length, 2)
        assert.equal(roles.calls.filter(c => c.method === "evaluate").length, 0)
        assert.equal(p.add.requests().length, 0); assert.equal(p.remove.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a periodic reward pass resumes dirty accounts and continues past a failed account", async () => {
    const f = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Deferred.make<void>(), later = yield* Deferred.make<void>(), secondPass = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        let lists = 0
        const remote = levelsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation
            if (op.type === "list") {
                lists++
                if (lists === 1) return { type: "accounts" as const, accounts: [account(p.targetId, [], [], 1), account(p.targetId, [], [], 2)], sweepPending: false }
                assert.equal(yield* Clock.currentTimeMillis, 60000); yield* Deferred.succeed(secondPass, undefined)
                return { type: "accounts" as const, accounts: [], sweepPending: false }
            }
            if (op.type === "done" && op.mark === 1) { yield* Deferred.succeed(first, undefined); return yield* Effect.fail(new LevelingStoreError({ operation: "work", status: 409 })) }
            if (op.type === "done") yield* Deferred.succeed(later, undefined)
            return { type: "progress" as const, recorded: true }
        }) })
        yield* startLevelRoleWorker(remote.store, roles.store, f.ids.guild, bot.client)
        yield* Deferred.await(first); yield* Deferred.await(later)
        yield* TestClock.adjust("60 seconds"); yield* Deferred.await(secondPass)
        assert.equal(lists, 2)
    })).pipe(Effect.provide(TestClock.layer())))
})
