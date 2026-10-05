import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { LevelingCandidate, LevelingFence, LevelingManageOperation, LevelingMemberContext, RolesMemberContext } from "../contracts.js"
import schema from "../convex/schema.ts"
import { levelForXp, LEVELING_DAY, LEVELING_WINDOW } from "../convex/levelingDomain.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-leveling-secret-not-a-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/leveling.ts": () => import("../convex/leveling.ts"), "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"), "../convex/levelingCleanup.ts": () => import("../convex/levelingCleanup.ts"),
    "../convex/roles.ts": () => import("../convex/roles.ts"), "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"), "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/roleReactions.ts": () => import("../convex/roleReactions.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const human = { ...owner, userId: "20", isOwner: false }
const joinedAt = "2023-11-14T22:00:00.000000Z"
const member = (userId = "20", roleIds: string[] = []): LevelingMemberContext => ({ userId, joinedAt, roleIds, isBot: false, timeoutUntil: null })
const roles = Array.from({ length: 25 }, (_, index) => ({ roleId: String(40 + index), permissions: "0", botCanManage: true, actorCanManage: true }))
const native = (roleIds: string[] = [], userId = "20"): RolesMemberContext => ({ ...member(userId, roleIds), botId: "999", botAuthorized: true, roles })
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal(response.headers.get("cache-control"), "no-store"); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
function fixture(t: TestContext) {
    let now = 1700000000000, sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const http = (path: string, body: unknown, auth = true) => db.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const manageRequest = (operation: LevelingManageOperation, actor = owner) => ({ ...source(), actor, operation })
    const manage = (operation: LevelingManageOperation, actor = owner) => http("/levels/manage", manageRequest(operation, actor))
    const query = (operation: unknown, actor = human, current = member(actor.userId)) => http("/levels/query", { serverId: "1", actor, member: current, observedAt: now, operation })
    const candidate = (userId = "20", channelId = "30"): LevelingCandidate => { const current = source(); return { messageId: current.messageId, createdAt: current.createdAt, userId, channelId, digest: (++sequence).toString(16).padStart(64, "0") } }
    const preflight = (candidate: LevelingCandidate) => http("/levels/preflight", { serverId: "1", candidate })
    const awardRequest = async (candidate: LevelingCandidate, current = member(candidate.userId)) => {
        const ready = await read(await preflight(candidate)); assert(ready.eligible)
        return { serverId: "1", candidate, policyRevision: ready.policyRevision, fence: ready.fence as LevelingFence, member: current, observedAt: now }
    }
    const award = async (candidate: LevelingCandidate, current = member(candidate.userId)) => http("/levels/award", await awardRequest(candidate, current))
    const enable = () => manage({ type: "settings", expectedRevision: 1, patch: { enabled: true } })
    const adjust = (xp: number, userId = "20") => manage({ type: "adjust", userId, xp, reason: "Synthetic score correction" })
    const mappings = (count = 1, revision = 1) => manage({ type: "mappings", expectedMappingRevision: revision, mappings: roles.slice(0, count).map((role, index) => ({ level: index + 1, roleId: role.roleId })), roles })
    const work = (operation: unknown) => http("/levels/work", { serverId: "1", operation })
    const list = async () => (await read(await work({ type: "list" }))).accounts
    const page = async (userId = "20") => { const account = (await list()).find((row: any) => row.userId === userId); assert(account, "Expected a due dirty account"); return account }
    const evaluate = (page: any, index = 0, context = native()) => http("/roles/evaluate", { serverId: "1", sourceId: page.targets[index].sourceId, createdAt: now, context, operation: { type: "level-sync", roleId: page.targets[index].roleId } })
    const checkpoint = (page: any) => work({ type: "done", userId: page.userId, mark: page.mark, complete: true })
    const roleBinding = (grant: any) => ({ serverId: "1", attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId })
    const dispatch = (grant: any, context = native()) => http("/roles/dispatch", { ...roleBinding(grant), context, claimToken: "b".repeat(32) })
    const outcome = (grant: any, value = "succeeded", claimed = true) => http("/roles/outcome", { ...roleBinding(grant), ...(claimed ? { claimToken: "b".repeat(32) } : {}), outcome: value })
    const apply = async (grant: any, context = native()) => { assert.equal((await read(await dispatch(grant, context))).claimed, true); await read(await outcome(grant)) }
    const mappingPage = (userId = "20") => page(userId)
    return { db, source, http, manageRequest, manage, query, candidate, preflight, awardRequest, award, enable, adjust, mappings, work, list, page, evaluate, checkpoint, roleBinding, dispatch, outcome, apply, mappingPage, advance: (ms: number) => { now += ms }, now: () => now }
}

test("Level routes authenticate before decoding, isolate the server and return disabled defaults without collection", async t => {
    const f = fixture(t)
    for (const route of ["manage", "query", "preflight", "award", "work"]) { await status(await f.http(`/levels/${route}`, "Synthetic malformed body", false), 401); await status(await f.http(`/levels/${route}`, { serverId: "2" }), 403) }
    const defaults = await read(await f.query({ type: "settings" }, owner)); assert.deepEqual(defaults.settings, { enabled: false, xpPerMessage: 15, cooldownSeconds: 60, excludedChannelIds: [], excludedRoleIds: [], revision: 1, mappingRevision: 1, scoreEpoch: 1, mappings: [] })
    assert.deepEqual(await read(await f.preflight(f.candidate())), { eligible: false, reason: "disabled" })
    assert.equal((await f.db.run(c => c.db.query("levelingSettings").collect())).length, 0)
    await status(await f.enable().then(async response => { await read(response); return f.manage({ type: "settings", expectedRevision: 2, patch: { xpPerMessage: 10 } }, human) }), 403)
    await status(await f.query({ type: "rank" }, human, member("21")), 403)
    await status(await f.query({ type: "status" }), 403)
    await status(await f.http("/levels/query", { serverId: "1", private: "x".repeat(262145) }), 413)
})

test("Configuration validates finite limits, source bindings and independent policy/mapping revisions", async t => {
    const f = fixture(t), request = f.manageRequest({ type: "settings", expectedRevision: 1, patch: { enabled: true, xpPerMessage: 100, cooldownSeconds: 15 } })
    await read(await f.http("/levels/manage", request)); assert.deepEqual(await read(await f.http("/levels/manage", request)), { duplicate: true })
    await status(await f.http("/levels/manage", { ...request, operation: { ...request.operation, patch: { enabled: false } } }), 409)
    for (const patch of [{ xpPerMessage: 0 }, { xpPerMessage: 101 }, { cooldownSeconds: 14 }, { cooldownSeconds: 3601 }, { excludedChannelIds: Array.from({ length: 51 }, (_, i) => String(i + 1)) }, { excludedRoleIds: Array.from({ length: 51 }, (_, i) => String(i + 1)) }, { unknown: true }]) await status(await f.manage({ type: "settings", expectedRevision: 2, patch } as LevelingManageOperation), 400)
    const map = await read(await f.mappings()); assert.equal(map.settings.revision, 2); assert.equal(map.settings.mappingRevision, 2)
    await status(await f.mappings(1), 409)
    await status(await f.manage({ type: "mappings", expectedMappingRevision: 2, mappings: [{ level: 1, roleId: "1" }], roles: [{ ...roles[0]!, roleId: "1" }] }), 403)
    await status(await f.manage({ type: "mappings", expectedMappingRevision: 2, mappings: Array.from({ length: 21 }, (_, i) => ({ level: i + 1, roleId: String(i + 40) })), roles }), 400)
    await status(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { staffRoleIds: { security: ["40"] } } } }), 409)
})

test("Atomic awards enforce both clocks, digest windows, source replay and fresh member/exclusion evidence without role authority", async t => {
    const f = fixture(t); await read(await f.enable())
    const first = f.candidate(), request = await f.awardRequest(first)
    const results = await Promise.all([f.http("/levels/award", request), f.http("/levels/award", request)])
    assert.deepEqual((await Promise.all(results.map(read))).map(r => r.awarded).sort(), [false, true])
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 15)
    f.advance(60000)
    assert.equal((await read(await f.preflight({ ...f.candidate(), digest: first.digest }))).reason, "duplicate")
    f.advance(60000)
    assert.equal((await read(await f.preflight({ ...f.candidate(), createdAt: first.createdAt + 30000 }))).reason, "cooldown")
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { excludedChannelIds: ["31"], excludedRoleIds: ["40"] } }))
    assert.equal((await read(await f.preflight(f.candidate("20", "31")))).reason, "excluded")
    assert.equal((await read(await f.award(f.candidate(), member("20", ["40"])))).reason, "excluded")
    assert.equal((await read(await f.award(f.candidate(), { ...member(), isBot: true }))).reason, "membership")
    assert.equal((await read(await f.award(f.candidate(), { ...member(), joinedAt: new Date(f.now() + 1).toISOString() }))).reason, "membership")
    assert.equal((await read(await f.preflight({ ...f.candidate(), createdAt: f.now() - LEVELING_WINDOW - 1 }))).reason, "stale")
    assert.equal((await read(await f.preflight({ ...f.candidate(), createdAt: f.now() + 1001 }))).reason, "stale")
    const fresh = await f.awardRequest(f.candidate()); await status(await f.http("/levels/award", { ...fresh, observedAt: f.now() - 60001 }), 400)
    await status(await f.http("/levels/preflight", { serverId: "1", candidate: { ...f.candidate(), content: "Synthetic body forbidden" } }), 400)
})

test("Reset cutoffs reject pre-reset queues even with a first preflight after reset and retain anti-replay/account fences", async t => {
    const f = fixture(t); await read(await f.enable()); const first = f.candidate(); await read(await f.award(first)); f.advance(60000)
    const queued = f.candidate(), prepared = await f.awardRequest(queued)
    const before = await f.db.run(c => c.db.query("levelingProfiles").first())
    await read(await f.manage({ type: "reset-member", userId: "20", confirm: "reset-member", reason: "Synthetic member reset" }))
    assert.equal((await read(await f.preflight(queued))).reason, "stale")
    assert.equal((await read(await f.http("/levels/award", prepared))).reason, "fence")
    let after = (await f.db.run(c => c.db.query("levelingProfiles").first()))!
    assert.equal(after.lastAwardAt, before!.lastAwardAt); assert.deepEqual(after.digests, before!.digests); assert.equal(after.adjustmentRevision, 1)
    f.advance(1); await read(await f.award(f.candidate())); f.advance(60000)
    const queuedGlobal = f.candidate(); await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic server reset" }))
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 0)
    assert.equal((await read(await f.query({ type: "leaderboard" }))).profiles.length, 0)
    assert.equal((await read(await f.preflight(queuedGlobal))).reason, "stale")
    f.advance(1); const result = await read(await f.award(f.candidate())); assert.equal(result.profile.xp, 15); assert.equal(result.profile.fence.adjustmentRevision, 1)
    after = (await f.db.run(c => c.db.query("levelingProfiles").first()))!; assert.equal(after.scoreEpoch, 2); assert.equal(after.digests.length, 3)
    assert.equal((await f.db.run(c => c.db.query("levelingAwardReceipts").collect())).length, 3)
    const audits = await read(await f.query({ type: "audits" }, owner)); assert.deepEqual(audits.audits.map((a: any) => a.type), ["reset-server", "reset-member"])
})

test("Policy and account fences reject reset/correction/settings races while bounded score caps and rejoin keep the account", async t => {
    const f = fixture(t); await read(await f.enable()); const prepared = await f.awardRequest(f.candidate())
    await read(await f.adjust(100)); assert.equal((await read(await f.http("/levels/award", prepared))).reason, "fence")
    const next = await f.awardRequest(f.candidate()); await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { xpPerMessage: 100 } })); assert.equal((await read(await f.http("/levels/award", next))).reason, "fence")
    await read(await f.adjust(99999999, "20")); const rejoined = { ...member(), joinedAt: new Date(f.now() - 1000).toISOString() }
    const capped = await read(await f.award(f.candidate(), rejoined)); assert.equal(capped.xpAdded, 1); assert.equal(capped.profile.xp, 100000000); assert.equal(capped.profile.level, 1000); assert.equal(capped.profile.nextLevelXp, null)
    assert.equal((await f.db.run(c => c.db.query("levelingProfiles").collect())).length, 1)
    assert.equal(levelForXp(99), 0); assert.equal(levelForXp(100), 1); assert.equal(levelForXp(399), 1); assert.equal(levelForXp(400), 2)
})

test("A delayed older correction cannot restore a score that a newer correction replaced", async t => {
    const f = fixture(t); await read(await f.enable())
    const older = f.manageRequest({ type: "adjust", userId: "20", xp: 100, reason: "Synthetic older correction" }); f.advance(1)
    await read(await f.adjust(400))
    await status(await f.http("/levels/manage", older), 409)
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 400)
})

test("Leaderboard tie continuation is bounded and stable, exact rank stops at 1000 and reset invalidates old cursors", async t => {
    const f = fixture(t)
    await f.db.run(async ctx => {
        for (let n = 1000; n < 2022; n++) await ctx.db.insert("levelingProfiles", { serverId: "1", userId: String(n), xp: n < 1025 ? 200 : 100, scoreEpoch: 1, adjustmentRevision: 0, digests: [] })
    })
    const pages: string[] = []; let cursor: any
    for (let n = 0; n < 3; n++) { const page = await read(await f.query({ type: "leaderboard", ...(cursor ? { cursor } : {}) })); assert(page.profiles.length <= 20); pages.push(...page.profiles.map((p: any) => p.userId)); cursor = page.nextCursor }
    assert.equal(new Set(pages).size, 60); assert.deepEqual(pages.slice(0, 25), Array.from({ length: 25 }, (_, i) => String(1024 - i)))
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "1000" }))).rank, { type: "exact", position: 25 })
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "1025" }))).rank, { type: "outside-top-1000" })
    await status(await f.query({ type: "leaderboard", cursor: { xp: -1, userId: "1", scoreEpoch: 1 } }), 400)
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic pagination reset" })); await status(await f.query({ type: "leaderboard", cursor }), 409)
})

test("Stored profile capacity rejects new members but keeps crediting existing ones", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.adjust(0))
    const state = (await f.db.run(c => c.db.query("levelingSettings").first()))!
    await f.db.run(c => c.db.patch(state._id, { profiles: 50000 }))
    assert.equal((await read(await f.preflight(f.candidate("21")))).reason, "capacity")
    assert.equal((await read(await f.award(f.candidate()))).awarded, true)
    assert.equal((await f.db.run(c => c.db.query("levelingProfiles").collect())).length, 1)
})

test("Reward attempts survive a new correction and a newer mark fences the older pass", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100))
    const page = await f.mappingPage(), result = await read(await f.evaluate(page)), grant = result.grant; assert(grant)
    assert.deepEqual(JSON.parse((await f.db.run(c => c.db.query("roleAttempts").first()))!.operationKey), { type: "level-sync", roleId: "40" })
    await f.apply(grant); await read(await f.checkpoint(page))
    await read(await f.adjust(0, "20")); const withdrawal = await f.page(), removal = (await read(await f.evaluate(withdrawal, 0, native(["40"])))).grant; assert.equal(removal.action, "remove")
    assert.equal((await read(await f.dispatch(removal, native(["40"])))).claimed, true)
    await read(await f.adjust(100, "20")); await read(await f.outcome(removal))
    assert.deepEqual(await read(await f.checkpoint(withdrawal)), { type: "progress", recorded: false })
    const queued = await f.list(); assert.equal(queued[0].mark > withdrawal.mark, true)
})

test("A retried reward pass re-adds a role when the member rejoined after an earlier success", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100))
    const page = await f.mappingPage(); await f.apply((await read(await f.evaluate(page))).grant)
    const rejoined = { ...native(), joinedAt: new Date(f.now() - 1000).toISOString() }, retried = await read(await f.evaluate(page, 0, rejoined))
    assert.equal(retried.status, "reserved"); assert.equal(retried.grant.joinedAt, rejoined.joinedAt)
})

test("All reward intent changes and newer intent source are checked before the one-time native claim", async t => {
    for (const change of ["adjust", "mapping", "reset", "intent"] as const) {
        const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100)); const page = await f.mappingPage(), grant = (await read(await f.evaluate(page))).grant
        if (change === "adjust") await read(await f.adjust(0, "20"))
        if (change === "mapping") await read(await f.mappings(0, 2))
        if (change === "reset") await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic fence reset" }))
        if (change === "intent") await f.db.run(async c => { const row = (await c.db.query("roleOwnership").first())!; await c.db.patch(row._id, { intentSourceId: "newer_intent" }) })
        const response = await f.dispatch(grant)
        if (change === "intent") assert.equal((await read(response)).claimed, false); else await status(response, 409)
        await read(await f.outcome(grant, "failed", false))
    }
})

test("Blocked and uncertain first roles do not starve later roles or members and dirty updates fence old completions", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings(12)); await read(await f.adjust(20000)); await read(await f.adjust(20000, "21"))
    let page = await f.mappingPage(), grant = (await read(await f.evaluate(page, 0))).grant
    assert.equal((await read(await f.dispatch(grant))).claimed, true); await read(await f.outcome(grant, "uncertain"))
    for (let index = 1; index < page.targets.length; index++) { const g = (await read(await f.evaluate(page, index))).grant; await f.apply(g) }
    assert.equal(page.targets.length, 12)
    assert.deepEqual(await read(await f.work({ type: "done", userId: "20", mark: page.mark, complete: false })), { type: "progress", recorded: true })
    assert.equal((await f.list()).some((row: any) => row.userId === "21"), true)
    const deferred = (await f.db.run(c => c.db.query("levelingProfiles").withIndex("by_user", q => q.eq("serverId", "1").eq("userId", "20")).unique()))!
    assert.equal(deferred.rewardDueAt! >= f.now() + 60000, true)
    f.advance(60000); page = await f.page(); assert.equal((await read(await f.evaluate(page, 0))).status, "blocked")
    const peer = await f.mappingPage("21")
    await read(await f.adjust(100, "21"))
    assert.deepEqual(await read(await f.checkpoint(peer)), { type: "progress", recorded: false })
    assert.equal((await f.list()).some((row: any) => row.userId === "21" && row.mark > peer.mark), true)
})

test("Demotion withdraws level references while disabled and preserves preexisting and other-consumer roles", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings(2)); await read(await f.adjust(400))
    const page = await f.mappingPage(), first = (await read(await f.evaluate(page, 0))).grant; await f.apply(first)
    assert.equal((await read(await f.evaluate(page, 1, native(["40", "41"])))).grant, undefined)
    await read(await f.checkpoint(page))
    await f.db.run(async ctx => { const owner = (await ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", "1").eq("userId", "20").eq("joinedAt", joinedAt).eq("roleId", "40")).unique())!; await ctx.db.insert("roleReferences", { serverId: "1", consumerKey: "autorole:1", roleId: "40", configuration: false, desired: true, ownershipId: owner._id, createdAt: f.now() }) })
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { enabled: false } })); await read(await f.adjust(0, "20"))
    const withdrawal = await f.page()
    for (let index = 0; index < withdrawal.targets.length; index++) assert.equal((await read(await f.evaluate(withdrawal, index, native(["40", "41"])))).grant, undefined)
    const refs = await f.db.run(c => c.db.query("roleReferences").collect()); assert.equal(refs.some(x => x.consumerKey === "autorole:1"), true); assert.equal(refs.filter(x => !x.configuration && x.consumerKey === "level").length, 0)
})

test("Mapping clear queues owned withdrawal while disabled and unavailable verification cannot grant", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100)); let page = await f.mappingPage(); await f.apply((await read(await f.evaluate(page))).grant); await read(await f.checkpoint(page))
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { enabled: false } })); await read(await f.mappings(0, 2))
    page = await f.page(); const removal = (await read(await f.evaluate(page, 0, native(["40"])))).grant; assert.equal(removal.action, "remove"); await f.apply(removal, native(["40"])); await read(await f.checkpoint(page))
    assert.equal((await f.db.run(c => c.db.query("roleReferences").collect())).length, 0)
    await read(await f.manage({ type: "settings", expectedRevision: 3, patch: { enabled: true } })); await read(await f.mappings(1, 3))
    await f.db.run(c => c.db.insert("rolePanels", { serverId: "1", name: "rules", kind: "verification", revision: 1, enabled: false, exclusive: false, withdrawing: false, mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }] }))
    page = await f.mappingPage(); await status(await f.evaluate(page), 403)
})

test("Typed absence and raw rejoin epochs retire only level references and never treat a failed read as absence", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100)); let page = await f.mappingPage(); await f.apply((await read(await f.evaluate(page))).grant); await read(await f.checkpoint(page))
    await read(await f.manage({ type: "reconcile", userId: "20" })); page = await f.page(); assert.deepEqual(page.refs, [{ roleId: "40", joinedAt }])
    const skip = (fields: Record<string, unknown>) => f.work({ type: "skip", userId: "20", mark: page.mark, roleId: "40", joinedAt, observedAt: f.now(), ...fields })
    await status(await skip({ currentJoinedAt: null }), 400)
    await status(await skip({ currentJoinedAt: joinedAt }), 409)
    const newEpoch = new Date(f.now()).toISOString()
    assert.deepEqual(await read(await skip({ currentJoinedAt: newEpoch })), { type: "progress", recorded: true })
    const current = { ...native(["40"]), joinedAt: newEpoch }
    assert.equal((await read(await f.evaluate(page, 0, current))).grant, undefined)
    const owners = await f.db.run(c => c.db.query("roleOwnership").collect()); assert.equal(owners.length, 1); assert.equal(owners[0]!.joinedAt, newEpoch); assert.equal(owners[0]!.owned, false)
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 100)
})

test("Expiry cleanup erases transient digest/receipt/audit state and retains permanent zero account fences", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.award(f.candidate())); await read(await f.manage({ type: "reset-member", userId: "20", confirm: "reset-member", reason: "Synthetic cleanup reset" }))
    const cleanup = makeFunctionReference<"mutation">("levelingCleanup:cleanup")
    f.advance(LEVELING_WINDOW); await f.db.mutation(cleanup, {})
    const profile = (await f.db.run(c => c.db.query("levelingProfiles").first()))!; assert.deepEqual(profile.digests, []); assert.equal(profile.adjustmentRevision, 1); assert(profile.resetAt)
    f.advance(LEVELING_DAY); await f.db.mutation(cleanup, {}); assert.equal((await f.db.run(c => c.db.query("levelingAwardReceipts").collect())).length, 0)
    f.advance(180 * LEVELING_DAY); await f.db.mutation(cleanup, {}); assert.equal((await f.db.run(c => c.db.query("levelingAudits").collect())).length, 0)
    assert.equal((await f.db.run(c => c.db.query("levelingProfiles").collect())).length, 1)
})

test("XP and reward claims recheck DEFCON, quarantine, timeout and protected-role policy after preflight/reservation", async t => {
    const f = fixture(t); await read(await f.enable()); const prepared = await f.awardRequest(f.candidate())
    await status(await f.http("/levels/award", { ...prepared, member: { ...member(), timeoutUntil: new Date(f.now() + 60000).toISOString() } }), 403)
    const moderation = (operation: unknown) => f.http("/moderation/manage", { ...f.source(), actor: owner, operation })
    await read(await moderation({ type: "settings", patch: { defcon: 2 } }))
    assert.equal((await read(await f.http("/levels/award", prepared))).reason, "policy")
    await read(await moderation({ type: "settings", patch: { defcon: 3 } }))
    await read(await moderation({ type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic quarantine fixture" }, context: { botId: "999", botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null } }))
    await status(await f.http("/levels/award", prepared), 403)
    await f.db.run(async ctx => { const row = (await ctx.db.query("securityRecoveries").first())!; await ctx.db.delete(row._id) })
    await read(await f.mappings()); await read(await f.adjust(100)); const page = await f.mappingPage(), grant = (await read(await f.evaluate(page))).grant
    await status(await f.dispatch(grant, { ...native(), botAuthorized: false }), 409)
    await status(await f.dispatch(grant, { ...native(), roles: [{ ...roles[0]!, permissions: "8" }] }), 403)
    await status(await f.dispatch(grant, { ...native(), timeoutUntil: new Date(f.now() + 60000).toISOString() }), 403)
    await f.db.run(c => c.db.insert("ticketRoleProtections", { serverId: "1", roleId: "40", configurationRefs: 1, nativeOwnershipRefs: 0, privateBodyRefs: 0, protected: true }))
    await status(await f.dispatch(grant), 403)
    await f.db.run(async c => { const row = (await c.db.query("ticketRoleProtections").first())!; await c.db.delete(row._id) })
    await read(await moderation({ type: "settings", patch: { defcon: 2 } })); await status(await f.dispatch(grant), 403)
})

test("Current configured verification requires acknowledgment, exact epoch access reference and fresh access presence", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100))
    const settings = { panelsEnabled: false, verificationEnabled: true, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 }
    await f.db.run(async ctx => {
        await ctx.db.insert("roleSettings", { serverId: "1", config: settings, nextPanelRevision: 1 })
        await ctx.db.insert("rolePanels", { serverId: "1", name: "rules", kind: "verification", revision: 1, enabled: true, exclusive: false, withdrawing: false, mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }], published: { revision: 1, publishedAt: f.now(), postNo: 1, postGeneration: 1, channelId: "30", messageId: "900", botId: "999", content: { content: "Synthetic rules" }, mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }], exclusive: false } })
    })
    const page = await f.mappingPage(); await status(await f.evaluate(page, 0, native(["41"])), 403)
    await f.db.run(async ctx => {
        await ctx.db.insert("roleAcknowledgments", { serverId: "1", userId: "20", joinedAt, rulesRevision: 1, panelName: "rules", acknowledgedAt: f.now() })
        const ownershipId = await ctx.db.insert("roleOwnership", { serverId: "1", userId: "20", joinedAt, roleId: "41", generation: 0, owned: false, protected: false, status: "idle", updatedAt: f.now() })
        await ctx.db.insert("roleReferences", { serverId: "1", consumerKey: "panel:rules:1", roleId: "41", configuration: false, desired: true, ownershipId, createdAt: f.now() })
    })
    await status(await f.evaluate(page), 403)
    const grant = (await read(await f.evaluate(page, 0, native(["41"])))).grant; assert(grant)
    await status(await f.dispatch(grant), 403)
    await f.apply(grant, native(["41"]))
})

test("A crashed pass keeps its account dirty and a reset re-marks it for a fresh pass", async t => {
    const f = fixture(t); await read(await f.enable()); await read(await f.mappings()); await read(await f.adjust(100))
    const page = await f.mappingPage(); assert((await read(await f.evaluate(page))).grant)
    assert.equal((await f.list()).length, 1)
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic crash reset" }))
    const next = (await f.list()).find((row: any) => row.userId === "20"); assert.equal(next.mark > page.mark, true)
    assert.deepEqual(await read(await f.checkpoint(page)), { type: "progress", recorded: false })
    const state = (await f.db.run(c => c.db.query("levelingSettings").first()))!; assert.equal(state.dirty, 1)
})
