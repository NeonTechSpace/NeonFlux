import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Effect, Redacted, Deferred, Fiber, Exit } from "effect"
import { createLevelingStore } from "../src/level-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { levelSettings, levelProfile } from "./level-fixture.ts"
import { mockBackend, type BackendCall } from "./backend-fake.ts"

const serverId = "123456789012345678", userId = "123456789012345679", messageId = "123456789012345680", roleId = "123456789012345681"
const secret = "synthetic-leveling-adapter-secret"
const config = { url: "https://synthetic-test.convex.cloud", secret: Redacted.make(secret) }
const actor: C.ModerationActor = { userId, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const member: C.LevelingMemberContext = { userId, joinedAt: "2026-10-01T00:00:00.123456Z", roleIds: [], isBot: false, timeoutUntil: null }
const candidate: C.LevelingCandidate = { userId, messageId, channelId: serverId, createdAt: 2000, digest: "a".repeat(64) }
const fence = { scoreEpoch: 1, adjustmentRevision: 0, mappingRevision: 1 }
const query: C.LevelingQueryRequest = { serverId, actor, member, observedAt: 2000, operation: { type: "rank" } }
const award: C.LevelingAwardRequest = { serverId, candidate, policyRevision: 1, fence, member, observedAt: 2000 }
function fixture(t: TestContext) {
    let payload: unknown, status = 200
    const requests: BackendCall[] = []
    mockBackend(t, call => { requests.push(call); return Response.json(payload, { status }) })
    return { store: createLevelingStore(config), requests, respond: (value: unknown, code = 200) => { payload = value; status = code } }
}
const rejected = (effect: Effect.Effect<unknown, unknown>) => assert.rejects(Effect.runPromise(effect), /LevelingStoreError/)

test("level adapter transports exact shared authenticated DTOs and preserves raw native membership", async t => {
    const f = fixture(t)
    f.respond({ eligible: true, policyRevision: 1, fence }); await Effect.runPromise(f.store.preflight({ serverId, candidate }))
    f.respond({ awarded: true, xpAdded: 15, profile: levelProfile(userId, 15), rewardQueued: false }); await Effect.runPromise(f.store.award(award))
    f.respond({ type: "rank", profile: levelProfile(userId, 15), rank: { type: "exact", position: 1 } }); await Effect.runPromise(f.store.query(query))
    f.respond({ duplicate: false, type: "settings", settings: { ...levelSettings(), enabled: true, revision: 2 } })
    const manage: C.LevelingManageRequest = { serverId, actor, messageId, createdAt: 2000, operation: { type: "settings", expectedRevision: 1, patch: { enabled: true } } }
    await Effect.runPromise(f.store.manage(manage))
    f.respond({ type: "accounts", accounts: [], sweepPending: false }); await Effect.runPromise(f.store.work({ serverId, operation: { type: "list" } }))
    assert.deepEqual(f.requests.map(r => r.path), ["/levels/preflight", "/levels/award", "/levels/query", "/levels/manage", "/levels/work"])
    assert.deepEqual(f.requests[1]!.body, award)
    for (const call of f.requests) {
        assert(call.signal instanceof AbortSignal)
        assert.equal(call.key, Redacted.value(deriveServiceKey(config.secret)))
        assert.equal(JSON.stringify(call).includes(secret), false)
        assert.equal(JSON.stringify(call.body).includes("content"), false)
    }
})

test("level adapter rejects inconsistent profile arithmetic, identity, fences, rank and extra private fields", async t => {
    const f = fixture(t), result = { awarded: true, xpAdded: 15, profile: levelProfile(userId, 100), rewardQueued: false }
    for (const response of [
        { ...result, profile: { ...result.profile, userId: messageId } }, { ...result, profile: { ...result.profile, level: 2 } },
        { ...result, profile: { ...result.profile, nextLevelXp: 401 } }, { ...result, profile: { ...result.profile, fence: { ...fence, adjustmentRevision: 1 } } },
        { ...result, content: "Synthetic private text" }, { ...result, xpAdded: 101 },
    ]) { f.respond(response); await rejected(f.store.award(award)) }
    f.respond({ awarded: true, xpAdded: 0, profile: levelProfile(userId, 100000000), rewardQueued: false })
    assert.equal((await Effect.runPromise(f.store.award(award))).awarded, true)
    f.respond({ type: "rank", profile: levelProfile(userId, 1), rank: { type: "exact", position: 50001 } }); await rejected(f.store.query(query))
    f.respond({ type: "rank", profile: levelProfile(userId, 1), rank: { type: "range", from: 300, to: 200 } }); await rejected(f.store.query(query))
    f.respond({ type: "rank", profile: levelProfile(userId, 1), rank: { type: "range", from: 102, to: 400 } }); await Effect.runPromise(f.store.query(query))
    f.respond({ type: "rank", profile: levelProfile(userId, 1), rank: { type: "unranked" } }); await rejected(f.store.query(query))
    f.respond({ type: "rank", profile: levelProfile(userId, 1), rank: { type: "outside-top-1000" } }); await Effect.runPromise(f.store.query(query))
})

test("leaderboard decoding enforces numeric and lexicographic ordering, bounded pages and exact continuation", async t => {
    const f = fixture(t), request: C.LevelingQueryRequest = { ...query, operation: { type: "leaderboard" } }
    const profiles = Array.from({ length: 10 }, (_, i) => levelProfile(String(BigInt(userId) - BigInt(i)), 100))
    const last = profiles.at(-1)!, nextCursor = { xp: last.xp, userId: last.userId, scoreEpoch: 1 }
    f.respond({ type: "leaderboard", profiles, nextCursor }); await Effect.runPromise(f.store.query(request))
    for (const value of [
        { type: "leaderboard", profiles: [...profiles, profiles[0]] }, { type: "leaderboard", profiles: [...profiles].reverse() },
        { type: "leaderboard", profiles, nextCursor: { ...nextCursor, xp: 99 } },
        { type: "leaderboard", profiles: [profiles[0]], nextCursor },
        { type: "leaderboard", profiles: [...profiles, levelProfile(String(BigInt(userId) - 10n), 100)] },
        { type: "leaderboard", profiles: [{ ...profiles[0], fence: { ...fence, scoreEpoch: 2 } }, profiles[1]] },
    ]) { f.respond(value); await rejected(f.store.query(request)) }
    f.respond({ type: "leaderboard", profiles: [levelProfile(userId, 100)] })
    await rejected(f.store.query({ ...request, operation: { type: "leaderboard", cursor: { xp: 100, userId, scoreEpoch: 1 } } }))
})

test("work decoding binds distinct reward accounts and targets without leaking role ownership internals", async t => {
    const f = fixture(t), request: C.LevelingWorkRequest = { serverId, operation: { type: "list" } }
    const account = { userId, mark: 2, refs: [{ roleId, joinedAt: member.joinedAt }], targets: [{ roleId, sourceId: "level_synthetic_profile_2_" + roleId }], complete: true }
    const result = { type: "accounts", accounts: [account], sweepPending: false }
    f.respond(result); await Effect.runPromise(f.store.work(request))
    for (const value of [{ ...result, accounts: [account, account] }, { ...result, accounts: [{ ...account, targets: [account.targets[0], account.targets[0]] }] },
        { ...result, accounts: [{ ...account, refs: [{ ...account.refs[0], ownershipId: "synthetic_private_owner" }] }] }, { ...result, accounts: [{ ...account, mark: 0 }] }]) {
        f.respond(value); await rejected(f.store.work(request))
    }
    f.respond({ type: "progress", recorded: true })
    await Effect.runPromise(f.store.work({ serverId, operation: { type: "done", userId, mark: 2, complete: true } }))
})

test("management decoding checks revisions and correction/reset audit correspondence", async t => {
    const f = fixture(t), request: C.LevelingManageRequest = { serverId, actor, messageId, createdAt: 2000, operation: { type: "adjust", userId, xp: 100, reason: "Synthetic correction" } }
    const profile = { ...levelProfile(userId, 100), fence: { ...fence, adjustmentRevision: 1 } }
    const audit = { auditNo: 1, actorId: userId, userId, beforeXp: 0, afterXp: 100, createdAt: 2001, type: "adjust", scoreEpoch: 1, reason: "Synthetic correction" }
    f.respond({ duplicate: false, type: "profile", profile, audit }); await Effect.runPromise(f.store.manage(request))
    for (const changed of [{ ...audit, userId: messageId }, { ...audit, actorId: messageId }, { ...audit, afterXp: 101 }, { ...audit, type: "reset-member" }, { ...audit, reason: "Other" }]) {
        f.respond({ duplicate: false, type: "profile", profile, audit: changed }); await rejected(f.store.manage(request))
    }
    const reset: C.LevelingManageRequest = { ...request, operation: { type: "reset-server", confirm: "reset-server", reason: "Synthetic reset" } }
    const resetAudit = { auditNo: 2, actorId: userId, createdAt: 2001, type: "reset-server", scoreEpoch: 2, reason: "Synthetic reset" }
    f.respond({ duplicate: false, type: "reset", settings: { ...levelSettings(), scoreEpoch: 2 }, audit: resetAudit }); await Effect.runPromise(f.store.manage(reset))
    f.respond({ duplicate: false, type: "reset", settings: levelSettings(), audit: resetAudit }); await rejected(f.store.manage(reset))
})

test("level transport retains typed backend failure and scoped cancellation aborts the request", async t => {
    const f = fixture(t)
    f.respond({ message: "Synthetic denial" }, 404)
    const failed = await Effect.runPromise(Effect.exit(f.store.query(query)))
    assert(Exit.isFailure(failed)); if (Exit.isFailure(failed)) assert.equal(failed.cause.reasons[0]?._tag === "Fail" && failed.cause.reasons[0].error.status, 404)
    let aborted = false
    await Effect.runPromise(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        mockBackend(t, call => new Promise<never>((_resolve, reject) => {
            call.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("Synthetic aborted")) }, { once: true })
            Effect.runSync(Deferred.succeed(entered, undefined))
        }))
        const fiber = yield* f.store.preflight({ serverId, candidate }).pipe(Effect.forkChild)
        yield* Deferred.await(entered); yield* Fiber.interrupt(fiber)
    }))
    assert.equal(aborted, true)
})
