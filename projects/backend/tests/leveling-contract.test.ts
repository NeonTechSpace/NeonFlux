import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createLevelingStore, LevelingStoreError } from "../../bot/src/level-store.ts"

const modules = {
    "../convex/leveling.ts": () => import("../convex/leveling.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
}
const joinedAt = "2023-11-14T22:00:00.000000Z"
const actor: C.ModerationActor = { userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const owner: C.ModerationActor = { ...actor, userId: "10", isOwner: true }
const member = (userId = actor.userId, roleIds: string[] = []): C.LevelingMemberContext => ({ userId, joinedAt, roleIds, isBot: false, timeoutUntil: null })

async function fixture(t: Parameters<typeof adapterFixture>[0]) {
    const f = await adapterFixture(t, modules), store = createLevelingStore(f.config)
    const queryInput = (operation: C.LevelingQueryRequest["operation"], who = actor): C.LevelingQueryRequest => ({ serverId: "1", actor: who, member: member(who.userId), observedAt: f.now(), operation })
    const query = (operation: C.LevelingQueryRequest["operation"], who = actor) => f.run<C.LevelingQueryResult>(store.query(queryInput(operation, who)))
    const manage = (operation: C.LevelingManageOperation) => f.run<C.LevelingManageResult>(store.manage({ ...f.source(), actor: owner, operation }))
    const candidate = (digestByte: string, userId = actor.userId, channelId = "30"): C.LevelingCandidate => ({ messageId: f.source().messageId, createdAt: f.now(), userId, channelId, digest: digestByte.repeat(64) })
    const preflight = (candidate: C.LevelingCandidate) => f.run<C.LevelingPreflightResult>(store.preflight({ serverId: "1", candidate }))
    const awardInput = async (candidate: C.LevelingCandidate, current = member(candidate.userId)): Promise<C.LevelingAwardRequest> => {
        const ready = await preflight(candidate)
        assert(ready.eligible)
        return { serverId: "1", candidate, policyRevision: ready.policyRevision, fence: ready.fence, member: current, observedAt: f.now() }
    }
    const award = (input: C.LevelingAwardRequest) => f.run<C.LevelingAwardResult>(store.award(input))
    const work = (operation: C.LevelingWorkRequest["operation"]) => f.run<C.LevelingWorkResult>(store.work({ serverId: "1", operation }))
    const enable = () => manage({ type: "settings", expectedRevision: 1, patch: { enabled: true } })
    return { ...f, store, queryInput, query, manage, candidate, preflight, awardInput, award, work, enable }
}

test("leveling adapter binds settings authority and credits through real policy and rank routes", async t => {
    const f = await fixture(t)
    assert.deepEqual(await f.preflight(f.candidate("a")), { eligible: false, reason: "disabled" })
    const defaults = await f.query({ type: "settings" }, owner)
    assert.equal(defaults.type, "settings")
    assert.equal(defaults.settings.enabled, false)
    assert.equal(defaults.settings.xpPerMessage, 15)
    await f.reject(createLevelingStore(f.wrongConfig).query(f.queryInput({ type: "settings" }, owner)), LevelingStoreError, 401)
    await f.reject(f.store.query(f.queryInput({ type: "settings" })), LevelingStoreError, 403)
    await f.reject(f.store.manage({ ...f.source(), actor, operation: { type: "settings", expectedRevision: 1, patch: { enabled: true } } }), LevelingStoreError, 403)

    const request: C.LevelingManageRequest = { ...f.source(), actor: owner, operation: { type: "settings", expectedRevision: 1,
        patch: { enabled: true, excludedChannelIds: ["31"], excludedRoleIds: ["40"] } } }
    const configured = await f.run<C.LevelingManageResult>(f.store.manage(request))
    assert(!configured.duplicate && configured.type === "settings")
    assert.equal(configured.settings.revision, 2)
    assert.deepEqual(await f.run<C.LevelingManageResult>(f.store.manage(request)), { duplicate: true })
    assert.deepEqual(await f.query({ type: "settings" }, owner), { type: "settings", settings: configured.settings })

    const first = f.candidate("b"), firstInput = await f.awardInput(first)
    const credited = await f.award(firstInput)
    assert(credited.awarded)
    assert.equal(credited.xpAdded, 15)
    assert.equal(credited.profile.xp, 15)
    assert.equal(credited.profile.level, 0)
    assert.equal(credited.profile.nextLevelXp, 100)
    assert.deepEqual(await f.award(firstInput), { awarded: false, reason: "duplicate" })
    assert.deepEqual(await f.preflight(f.candidate("c")), { eligible: false, reason: "cooldown" })
    assert.deepEqual(await f.preflight(f.candidate("d", actor.userId, "31")), { eligible: false, reason: "excluded" })
    f.advance(60000)
    assert.deepEqual(await f.preflight({ ...f.candidate("b"), digest: first.digest }), { eligible: false, reason: "duplicate" })
    assert.deepEqual(await f.award(await f.awardInput(f.candidate("e"), member(actor.userId, ["40"]))), { awarded: false, reason: "excluded" })
    const peer = await f.award(await f.awardInput(f.candidate("f", "21")))
    assert(peer.awarded)
    const rank = await f.query({ type: "rank" })
    assert.equal(rank.type, "rank")
    assert.deepEqual(rank.profile, credited.profile)
    assert.deepEqual(rank.rank, { type: "exact", position: 2 })
    const leaderboard = await f.query({ type: "leaderboard" })
    assert.equal(leaderboard.type, "leaderboard")
    assert.deepEqual(leaderboard.profiles, [peer.profile, credited.profile])
    assert.equal(leaderboard.nextCursor, undefined)
    assert.deepEqual(new Set(f.calls.map(call => call.path)), new Set(["/levels/manage", "/levels/query", "/levels/preflight", "/levels/award"]))
})

test("leveling adapter rejects duplicate mapping levels and roles without changing persisted state", async t => {
    const f = await fixture(t)
    const roles = ["41", "42"].map(roleId => ({ roleId, permissions: "0", botCanManage: true, actorCanManage: true }))
    const distinct = [{ level: 1000, roleId: "42" }, { level: 1, roleId: "41" }]
    const configured = await f.manage({ type: "mappings", expectedMappingRevision: 1, mappings: distinct, roles })
    assert(!configured.duplicate && configured.type === "settings")
    assert.deepEqual(configured.settings.mappings, [...distinct].reverse())
    const settings = await f.query({ type: "settings" }, owner), audits = await f.query({ type: "audits" }, owner)
    const status = await f.query({ type: "status" }, owner)
    assert.deepEqual(settings, { type: "settings", settings: configured.settings })

    for (const mappings of [[{ level: 1, roleId: "41" }, { level: 1, roleId: "42" }],
        [{ level: 1, roleId: "41" }, { level: 2, roleId: "41" }]]) {
        await f.reject(f.store.manage({ ...f.source(), actor: owner, operation: { type: "mappings", expectedMappingRevision: 2, mappings, roles } }), LevelingStoreError, 400)
        assert.deepEqual(f.calls.at(-1), { path: "/levels/manage", status: 400 })
        assert.deepEqual(await f.query({ type: "settings" }, owner), settings)
        assert.deepEqual(await f.query({ type: "audits" }, owner), audits)
        assert.deepEqual(await f.query({ type: "status" }, owner), status)
    }

    const updated = await f.manage({ type: "mappings", expectedMappingRevision: 2, mappings: [{ level: 2, roleId: "41" }, { level: 999, roleId: "42" }], roles })
    assert(!updated.duplicate && updated.type === "settings")
    assert.equal(updated.settings.mappingRevision, 3)
    assert.deepEqual(await f.query({ type: "settings" }, owner), { type: "settings", settings: updated.settings })
})

test("leveling adapter bounds correction and reset reasons before committing and round trips 500 characters", async t => {
    const f = await fixture(t), reason = "R".repeat(500)
    const adjusted = await f.manage({ type: "adjust", userId: actor.userId, xp: 450, reason })
    assert(!adjusted.duplicate && adjusted.type === "profile")
    assert.equal(adjusted.audit.reason, reason)
    const snapshot = async () => ({ settings: await f.query({ type: "settings" }, owner), audits: await f.query({ type: "audits" }, owner),
        rank: await f.query({ type: "rank" }), status: await f.query({ type: "status" }, owner) })
    const before = await snapshot()
    for (const length of [501, 512]) {
        const oversized = "R".repeat(length)
        const operations: C.LevelingManageOperation[] = [
            { type: "adjust", userId: actor.userId, xp: 900, reason: oversized },
            { type: "reset-member", userId: actor.userId, confirm: "reset-member", reason: oversized },
            { type: "reset-server", confirm: "reset-server", reason: oversized },
        ]
        for (const operation of operations) {
            await f.reject(f.store.manage({ ...f.source(), actor: owner, operation }), LevelingStoreError, 400)
            assert.deepEqual(f.calls.at(-1), { path: "/levels/manage", status: 400 })
            assert.deepEqual(await snapshot(), before)
        }
    }
    const reset = await f.manage({ type: "reset-member", userId: actor.userId, confirm: "reset-member", reason })
    assert(!reset.duplicate && reset.type === "profile")
    assert.equal(reset.profile.xp, 0)
    assert.equal(reset.audit.reason, reason)
    const serverReset = await f.manage({ type: "reset-server", confirm: "reset-server", reason })
    assert(!serverReset.duplicate && serverReset.type === "reset")
    assert.equal(serverReset.settings.scoreEpoch, 2)
    assert.equal(serverReset.audit.reason, reason)
    assert.deepEqual(await f.query({ type: "settings" }, owner), { type: "settings", settings: serverReset.settings })
    assert.deepEqual(await f.query({ type: "audits" }, owner), { type: "audits", audits: [serverReset.audit, reset.audit, adjusted.audit] })
})

test("leveling adapter preserves leaderboard continuation and rejects a reset epoch cursor", async t => {
    const f = await fixture(t)
    for (let userId = 100; userId <= 120; userId++) {
        const result = await f.manage({ type: "adjust", userId: String(userId), xp: 100, reason: "Synthetic leaderboard fixture" })
        assert(!result.duplicate && result.type === "profile")
    }
    const first = await f.query({ type: "leaderboard" })
    assert.equal(first.type, "leaderboard")
    assert.equal(first.profiles.length, 20)
    assert.equal(first.profiles[0]!.userId, "120")
    assert.deepEqual(first.nextCursor, { userId: "101", xp: 100, scoreEpoch: 1 })
    const second = await f.query({ type: "leaderboard", cursor: first.nextCursor })
    assert.equal(second.type, "leaderboard")
    assert.deepEqual(second.profiles.map(profile => profile.userId), ["100"])
    assert.equal(second.nextCursor, undefined)
    await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic cursor reset" })
    await f.reject(f.store.query(f.queryInput({ type: "leaderboard", cursor: first.nextCursor })), LevelingStoreError, 409)
    const resetPage = await f.query({ type: "leaderboard" })
    assert.equal(resetPage.type, "leaderboard")
    assert.deepEqual(resetPage.profiles, [])
})

test("leveling adapter round trips dirty reward accounts, deferral and completion", async t => {
    const f = await fixture(t)
    await f.manage({ type: "settings", expectedRevision: 1, patch: { enabled: true, xpPerMessage: 100 } })
    const mappings = await f.manage({ type: "mappings", expectedMappingRevision: 1, mappings: [{ level: 1, roleId: "41" }],
        roles: [{ roleId: "41", permissions: "0", botCanManage: true, actorCanManage: true }] })
    assert(!mappings.duplicate && mappings.type === "settings")
    assert.equal(mappings.settings.mappingRevision, 2)
    const credited = await f.award(await f.awardInput(f.candidate("a")))
    assert(credited.awarded)
    assert.equal(credited.profile.level, 1)
    assert.equal(credited.rewardQueued, true)
    const listed = await f.work({ type: "list" })
    assert(listed.type === "accounts")
    assert.equal(listed.accounts.length, 1)
    const account = listed.accounts[0]!
    assert.equal(account.userId, actor.userId)
    assert.deepEqual(account.refs, [])
    assert.deepEqual(account.targets.map(target => target.roleId), ["41"])
    assert.equal(account.complete, true)
    // An unsettled pass defers the account under a new mark, so the old mark can no longer clear it
    assert.deepEqual(await f.work({ type: "done", userId: actor.userId, mark: account.mark, complete: false }), { type: "progress", recorded: true })
    assert.deepEqual(await f.work({ type: "done", userId: actor.userId, mark: account.mark, complete: true }), { type: "progress", recorded: false })
    const deferred = await f.work({ type: "list" })
    assert(deferred.type === "accounts")
    assert.deepEqual(deferred.accounts, [])
    const status = await f.query({ type: "status" }, owner)
    assert(status.type === "status")
    assert.equal(status.dirty, 1)

    f.advance(60000)
    const retry = await f.work({ type: "list" })
    assert(retry.type === "accounts")
    const next = retry.accounts[0]!
    assert.equal(next.mark, account.mark + 1)
    assert.notEqual(next.targets[0]!.sourceId, account.targets[0]!.sourceId)
    const absent = { type: "skip" as const, userId: actor.userId, mark: next.mark, roleId: "41", joinedAt: "2020-01-01T00:00:00Z", observedAt: f.now(), currentJoinedAt: null, memberAbsent: true as const }
    assert.deepEqual(await f.work(absent), { type: "progress", recorded: true })
    assert.deepEqual(await f.work({ type: "done", userId: actor.userId, mark: next.mark, complete: true }), { type: "progress", recorded: true })
    const finished = await f.work({ type: "list" })
    assert(finished.type === "accounts")
    assert.deepEqual(finished.accounts, [])
    const clean = await f.query({ type: "status" }, owner)
    assert(clean.type === "status")
    assert.equal(clean.dirty, 0)
    assert(f.calls.some(call => call.path === "/levels/work"))
})

test("leveling adapter round trips correction audits and reset fences without erasing replay guards", async t => {
    const f = await fixture(t)
    await f.enable()
    const first = f.candidate("a"), credited = await f.award(await f.awardInput(first))
    assert(credited.awarded)
    f.advance(60000)
    const queued = f.candidate("b"), beforeCorrection = await f.awardInput(queued)
    const adjusted = await f.manage({ type: "adjust", userId: actor.userId, xp: 450, reason: "Synthetic score correction" })
    assert(!adjusted.duplicate && adjusted.type === "profile")
    assert.equal(adjusted.profile.level, 2)
    assert.equal(adjusted.profile.nextLevelXp, 900)
    assert.equal(adjusted.audit.beforeXp, 15)
    assert.equal(adjusted.audit.afterXp, 450)
    assert.deepEqual(await f.award(beforeCorrection), { awarded: false, reason: "fence" })

    const reset = await f.manage({ type: "reset-member", userId: actor.userId, confirm: "reset-member", reason: "Synthetic member reset" })
    assert(!reset.duplicate && reset.type === "profile")
    assert.equal(reset.profile.xp, 0)
    assert.equal(reset.profile.fence.adjustmentRevision, 2)
    assert.deepEqual(await f.preflight(queued), { eligible: false, reason: "stale" })
    f.advance(1)
    assert.deepEqual(await f.preflight({ ...f.candidate("a"), digest: first.digest }), { eligible: false, reason: "duplicate" })
    const afterReset = await f.award(await f.awardInput(f.candidate("c")))
    assert(afterReset.awarded)
    assert.equal(afterReset.profile.xp, 15)

    f.advance(60000)
    const beforeServerReset = await f.awardInput(f.candidate("d"))
    const serverReset = await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic server reset" })
    assert(!serverReset.duplicate && serverReset.type === "reset")
    assert.equal(serverReset.settings.scoreEpoch, 2)
    assert.deepEqual(await f.award(beforeServerReset), { awarded: false, reason: "fence" })
    assert.deepEqual(await f.preflight(beforeServerReset.candidate), { eligible: false, reason: "stale" })
    const rank = await f.query({ type: "rank" })
    assert.equal(rank.type, "rank")
    assert.equal(rank.profile.xp, 0)
    assert.equal(rank.profile.fence.scoreEpoch, 2)
    assert.equal(rank.profile.fence.adjustmentRevision, 2)
    assert.deepEqual(rank.rank, { type: "unranked" })
    const audits = await f.query({ type: "audits" }, owner)
    assert.equal(audits.type, "audits")
    assert.deepEqual(audits.audits, [serverReset.audit, reset.audit, adjusted.audit])
    assert.equal(audits.nextBeforeAuditNo, undefined)
})
