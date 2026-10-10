import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { CleanupContext, CleanupGrant, CleanupMessage, CleanupSweep, CleanupSweepBinding, CleanupTarget, CleanupTargetBinding } from "../contracts.js"
import schema from "../convex/schema.ts"
import { cleanupBoundary, cleanupEligibility, CLEANUP_DAY, CLEANUP_EPOCH, CLEANUP_GRANT_MS, CLEANUP_RETENTION, CLEANUP_SETTLE_MS } from "../convex/cleanupDomain.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-cleanup-secret-not-a-real-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/cleanup.ts": () => import("../convex/cleanup.ts"), "../convex/cleanupWork.ts": () => import("../convex/cleanupWork.ts"), "../convex/cleanupRetention.ts": () => import("../convex/cleanupRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"), "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const member = (userId: string, isBot = false) => ({ userId, joinedAt: "2024-01-01T00:00:00.000001Z", roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }), source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (userId = "10", channelId = "30"): CleanupContext => ({ observedAt: now, actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" }, actorKind: "human", botKind: "bot", channelId, channelType: 0, botId: "999", actorAuthorized: true, botAuthorized: true, member: member(userId), botMember: member("999", true) })
    const message = (at = now - 3600001, flags: Partial<CleanupMessage> = {}): CleanupMessage => ({ messageId: (BigInt(cleanupBoundary(at)) + 1n).toString(), channelId: "30", serverId: "1", observedAt: now, createdAt: new Date(at).toISOString(), authorId: "20", authorBot: false, authorSystem: false, type: 0, pinned: false, webhookId: null, ...flags })
    const http = (path: string, body: unknown, authenticated = true) => botCall(db, path, body, authenticated ? {} : { secret: null })
    const manage = (operation: unknown, proof = context()) => http("/cleanup/manage", { ...source(), context: proof, operation })
    const query = (operation: unknown, proof = context()) => http("/cleanup/query", { serverId: "1", context: proof, operation })
    const work = (operation: unknown) => http("/cleanup/work", { serverId: "1", operation })
    const policy = (channelId = "30") => query({ type: "show", channelId }).then(read).then(r => r.policy)
    const binding = (r: CleanupSweepBinding) => ({ channelId: r.channelId, policyRevision: r.policyRevision, moduleRevision: r.moduleRevision, sweepNo: r.sweepNo })
    const targetBinding = (r: CleanupTarget | CleanupGrant): CleanupTargetBinding => ({ ...binding(r), pageNo: r.pageNo, targetNo: r.targetNo, messageId: r.messageId })
    const open = async (channelId = "30", ageMs = 3600000) => {
        const settings = await query({ type: "settings" }).then(read)
        if (!settings.settings.enabled) await read(await manage({ type: "module", expectedRevision: settings.settings.revision, enabled: true }))
        const p = await read(await manage({ type: "configure", channelId, expectedRevision: 0, ageMs }, context("10", channelId)))
        await read(await manage({ type: "enable", channelId, expectedRevision: p.policy.revision, enabled: true, confirm: true }, context("10", channelId)))
    }
    const start = async (channelId = "30") => work({ type: "start", channelId, expectedRevision: (await policy(channelId)).revision, context: context("10", channelId) }).then(read)
    const page = (sweep: CleanupSweep, messages: CleanupMessage[]) => work({ type: "page", binding: binding(sweep), pageNo: sweep.pageNo, before: sweep.before, messages, context: context(sweep.ownerId, sweep.channelId) })
    const prepare = async (messages = [message()]) => { await open(); const s = await start(); const p = await page(s.sweep, messages).then(read); return { sweep: s.sweep as CleanupSweep, page: p.page, targets: p.targets as CleanupTarget[] } }
    const reserve = (target: CleanupTarget, proof = context(), m = { ...target.message, observedAt: now }) => work({ type: "reserve", binding: targetBinding(target), context: proof, message: m })
    const claim = (target: CleanupTarget, proof = context(), m = { ...target.message, observedAt: now }, claimToken = "a".repeat(32)) => work({ type: "claim", binding: targetBinding(target), context: proof, message: m, claimToken })
    const outcome = (target: CleanupTarget, result = "deleted", extra: Record<string, unknown> = { claimToken: "a".repeat(32) }) => work({ type: "outcome", binding: targetBinding(target), outcome: result, ...extra })
    const advance = (sweep: CleanupSweep) => work({ type: "advance", binding: binding(sweep), pageNo: sweep.pageNo })
    const view = (channelId = "30") => query({ type: "status", channelId }).then(read)
    const cleanup = () => db.mutation(makeFunctionReference<"mutation">("cleanupRetention:cleanup"), {})
    const defcon = async (level: 1 | 2 | 3) => db.run(async ctx => {
        const old = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", "1")).unique()
        if (old) await ctx.db.patch(old._id, { config: { ...old.config, defcon: level } })
        else await ctx.db.insert("moderationSettings", { serverId: "1", config: { ...defaultSettings(), defcon: level }, nextCaseNo: 1, nextAppealNo: 1 })
    })
    return { db, source, context, message, http, manage, query, work, policy, binding, targetBinding, open, start, page, prepare, reserve, claim, outcome, advance, view, cleanup, defcon, now: () => now, advanceTime: (ms: number) => { now += ms } }
}

test("Cleanup starts independently disabled, strict request shapes and age bounds are enforced", async t => {
    const f = await fixture(t), settings = (await read(await f.query({ type: "settings" }))).settings
    assert.equal(settings.enabled, false); assert.equal(settings.retainedTargets, 0); assert.equal(settings.targetCapacity, 10000)
    await status(await f.work({ type: "start", channelId: "30", expectedRevision: 1, context: f.context() }), 404)
    for (const ageMs of [3599999, 365 * CLEANUP_DAY + 1, 3600000.5]) await status(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs }), 400)
    await status(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000, extra: true }), 400)
    await status(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }, f.context("20")), 403)
    await status(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }, { ...f.context(), actorKind: "unknown" }), 403)
    await read(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 365 * CLEANUP_DAY }))
    assert.equal((await f.policy()).enabled, false)
    await status(await f.manage({ type: "enable", channelId: "30", expectedRevision: 1, enabled: true }), 400)
    await status(await f.http("/cleanup/query", { serverId: "1", context: f.context(), operation: { type: "settings" } }, false), 401)
    await status(await f.http("/cleanup/query", { serverId: "2", context: f.context(), operation: { type: "settings" } }), 403)
})

test("Policy source receipts bind actual actor, keep ordered mutation fence after receipt expiry", async t => {
    const f = await fixture(t), source = f.source(), operation = { type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }
    const send = (op = operation, proof = f.context()) => f.http("/cleanup/manage", { ...source, context: proof, operation: op })
    await read(await send()); assert.equal((await read(await send())).duplicate, true)
    await status(await send({ ...operation, ageMs: 7200000 }), 409)
    await status(await send(operation, f.context("11")), 409)
    f.advanceTime(CLEANUP_DAY + 1); await f.cleanup()
    await status(await f.http("/cleanup/manage", { ...source, createdAt: f.now(), context: f.context(), operation: { ...operation, expectedRevision: 1 } }), 409)
    assert.equal((await f.policy()).ageMs, 3600000)
})

test("Preview counts include unknown skips and fail closed for absent raw identity flags, unknown pins and timestamps", async t => {
    const f = await fixture(t); await f.open()
    const flags: Partial<CleanupMessage>[] = [{}, { authorBot: null }, { authorSystem: null }, { pinned: null }, { createdAt: null }, { authorBot: true }, { webhookId: "55" }, { type: 7 }, { pinned: true }, { type: null }, { authorId: null }, { createdAt: new Date(f.now()).toISOString() }]
    const messages = flags.map((flags, index) => f.message(f.now() - 3600001 - index, flags))
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages }))
    assert.equal(preview.eligible, 1); assert.equal(preview.skipped, 11); assert.equal(preview.unknown, 7)
    assert.equal(preview.eligible + preview.skipped, messages.length)
    assert.equal((await f.view()).targets.length, 0)
    const policy = await f.policy(), cutoff = f.now() - policy.ageMs
    assert.equal(cleanupEligibility(f.message(cutoff), policy, cutoff), "too-new")
    assert.equal(cleanupEligibility(f.message(cutoff - 1), policy, cutoff), null)
    assert.equal(cleanupBoundary(cutoff), ((BigInt(cutoff) - BigInt(CLEANUP_EPOCH)) << 22n).toString())
})

test("Frozen cutoff uses public boundary and short raw skipped pages advance without treating short page as end", async t => {
    const f = await fixture(t); await f.open(); const first = await f.start(), sweep = first.sweep as CleanupSweep
    assert.equal(sweep.before, cleanupBoundary(f.now() - 3600000))
    const raw = [f.message(f.now() - 3600001, { pinned: true }), f.message(f.now() - 3600002, { authorBot: true })]
    const saved = await read(await f.page(sweep, raw)); assert.equal(saved.targets.length, 0); assert.equal(saved.page.nextBefore, raw[1]!.messageId)
    await read(await f.advance(sweep)); f.advanceTime(60000)
    const resumed = await f.start(); assert.equal(resumed.sweep.cutoffAt, sweep.cutoffAt); assert.equal(resumed.sweep.before, raw[1]!.messageId); assert.equal(resumed.sweep.state, "active")
    assert.equal(resumed.page, null); assert.equal(resumed.sweep.counts.skipped, 2)
    await read(await f.page(resumed.sweep, [])); const ended = await read(await f.advance(resumed.sweep)); assert.equal(ended.complete, true)
    f.advanceTime(60000); const next = await f.start(); assert(next.sweep.cutoffAt > sweep.cutoffAt); assert.notEqual(next.sweep.sweepNo, sweep.sweepNo)
})

test("Durable raw pages reject malformed order, duplicate IDs, channel mismatch and boundary equality", async t => {
    const f = await fixture(t); await f.open(); const started = await f.start(), s = started.sweep as CleanupSweep, m1 = f.message(), m2 = f.message(f.now() - 3600002)
    for (const raw of [[m1, m1], [m2, m1], [{ ...m1, channelId: "31" }], [{ ...m1, serverId: "2" }], [f.message(s.cutoffAt)]]) await status(await f.page(s, raw), 409)
    assert.equal((await f.view()).page, null); assert.equal((await f.view()).settings.retainedTargets, 0)
    const saved = await read(await f.page(s, [m1, m2])); assert.equal(saved.targets.length, 2)
    assert.equal((await read(await f.page(s, [m1, m2]))).targets.length, 2)
    await status(await f.page(s, [{ ...m1, pinned: true }, m2]), 409)
    assert.equal((await f.view()).settings.retainedTargets, 2)
})

test("Partial page retains queued remainder, exact claims are one-time and completion compacts raw skips", async t => {
    const f = await fixture(t), p = await f.prepare([f.message(), f.message(f.now() - 3600002), f.message(f.now() - 3600003, { pinned: true })]), first = p.targets[0]!, second = p.targets[1]!
    assert.equal((await read(await f.advance(p.sweep))).recorded, false)
    const g = await f.reserve(first).then(read); assert.equal(g.grant.dispatchExpiresAt, f.now() + CLEANUP_GRANT_MS)
    assert.equal((await read(await f.claim(first))).claimed, true)
    assert.equal((await read(await f.claim(first))).claimed, false)
    assert.equal((await read(await f.claim(first, f.context(), first.message, "b".repeat(32)))).claimed, false)
    await status(await f.outcome(first, "deleted", { claimToken: "b".repeat(32) }), 403)
    await read(await f.outcome(first)); assert.equal((await read(await f.outcome(first))).recorded, false)
    assert.equal((await read(await f.advance(p.sweep))).recorded, false)
    f.advanceTime(60000); const resumed = await f.start(); assert(resumed.page); assert.equal(resumed.targets[1].state, "queued"); assert.equal(resumed.sweep.before, p.sweep.before)
    await read(await f.outcome(second, "failed", { noDispatch: true })); await read(await f.advance(p.sweep))
    const state = await f.view(); assert.equal(state.page, null); assert.equal(state.sweep.before, p.page.nextBefore)
    assert.equal(state.sweep.counts.acknowledged, 1); assert.equal(state.sweep.counts.attempted, 1); assert.equal(state.sweep.counts.submitted, 1); assert.equal(state.sweep.counts.failed, 1); assert.equal(state.sweep.counts.skipped, 1)
    assert(!JSON.stringify(state).includes("claimToken")); assert(!JSON.stringify(state).includes("content"))
})

test("Fresh exact eligibility and publisher/panel references are checked atomically at claim", async t => {
    const f = await fixture(t), p = await f.prepare(), target = p.targets[0]!
    await read(await f.reserve(target))
    await f.db.run(ctx => ctx.db.insert("publishingPosts", { serverId: "1", postNo: 1, generation: 1, channelId: "30", botId: "999", messageId: target.messageId, outcome: "uncertain", createdAt: f.now(), updatedAt: f.now() }))
    const blocked = await read(await f.claim(target)); assert.equal(blocked.type, "target"); assert.equal(blocked.target.state, "skipped"); assert.equal(blocked.target.reason, "protected"); assert.equal(blocked.target.noDispatch, true)
    const extra = f.message(f.now() - 3600004)
    await f.db.run(ctx => ctx.db.insert("rolePanels", { serverId: "1", name: "disabled-panel", kind: "reaction", revision: 1, enabled: false, exclusive: false, mappings: [], withdrawing: false, published: { revision: 1, publishedAt: f.now(), postNo: 99, postGeneration: 1, channelId: "30", messageId: extra.messageId, botId: "999", content: { content: "" }, mappings: [], exclusive: false } }))
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [extra] })); assert.equal(preview.items[0].reason, "protected")
})

test("Fresh pin and explicit exclusion changes close undispatched work truthfully", async t => {
    const f = await fixture(t), p = await f.prepare(), target = p.targets[0]!
    await read(await f.reserve(target)); const pinned = await read(await f.claim(target, f.context(), { ...target.message, pinned: true }))
    assert.equal(pinned.target.state, "skipped"); assert.equal(pinned.target.reason, "pinned")
    await read(await f.manage({ type: "exclude", channelId: "30", expectedRevision: 2, kind: "author", id: "20", add: true }))
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [f.message()] })); assert.equal(preview.items[0].reason, "excluded-author")
    assert.equal((await f.view()).sweep, null)
})

test("Bot identity, permissions, participant timeouts and DEFCON gate automatic work, never the configuring admin", async t => {
    const f = await fixture(t), p = await f.prepare(), target = p.targets[0]!
    const contexts: CleanupContext[] = [{ ...f.context(), botKind: "unknown" }, { ...f.context(), botAuthorized: false }, { ...f.context(), botMember: { ...f.context().botMember, timeoutUntil: new Date(f.now() + 1000).toISOString() } }]
    for (const proof of contexts) await status(await f.reserve(target, proof), 403)
    // The configuring admin may leave or lose permissions. Automatic work only needs the bot
    await read(await f.reserve(target, { ...f.context("20"), actorAuthorized: false })); await f.defcon(2); assert.equal((await read(await f.claim(target))).claimed, true)
    await f.defcon(1); await status(await f.work({ type: "list" }), 403)
    await read(await f.manage({ type: "enable", channelId: "30", expectedRevision: 2, enabled: false }, f.context("11")))
    await read(await f.outcome(target)); assert.equal((await f.view()).targets[0].state, "deleted")
})

test("Unclaimed expiration proves no dispatch, while lost claim response ages uncertain without replay", async t => {
    const f = await fixture(t), p = await f.prepare([f.message(), f.message(f.now() - 3600002)]), first = p.targets[0]!, second = p.targets[1]!
    await read(await f.reserve(first)); await read(await f.reserve(second)); await read(await f.claim(second))
    f.advanceTime(CLEANUP_GRANT_MS + CLEANUP_SETTLE_MS + 1); await f.cleanup()
    const state = await f.view(), failed = state.targets.find((r: CleanupTarget) => r.targetNo === first.targetNo), uncertain = state.targets.find((r: CleanupTarget) => r.targetNo === second.targetNo)
    assert.equal(failed.state, "failed"); assert.equal(failed.noDispatch, true); assert.equal(uncertain.state, "uncertain"); assert.equal(uncertain.noDispatch, undefined); assert.equal(uncertain.expiresAt, undefined)
    assert.equal(state.sweep.counts.submitted, 0); assert.equal(state.sweep.counts.unresolved, 1)
    await status(await f.reserve(second), 409)
    await read(await f.advance(p.sweep)); const next = await f.start(); await read(await f.page(next.sweep, [])); await read(await f.advance(next.sweep))
    const fresh = await f.start(), raw = [f.message(Date.parse(first.message.createdAt!)), f.message(Date.parse(second.message.createdAt!))]
    const saved = await read(await f.page(fresh.sweep, raw)); assert.equal(saved.targets.length, 1); assert.equal(saved.page.items[1].reason, "retained-attempt")
})

test("Revision/module invalidation cancels only unclaimed targets and accepts old claimed actual outcome", async t => {
    const f = await fixture(t), p = await f.prepare([f.message(), f.message(f.now() - 3600002)]), claimed = p.targets[0]!, queued = p.targets[1]!
    await read(await f.reserve(claimed)); await read(await f.claim(claimed))
    await read(await f.manage({ type: "module", expectedRevision: 2, enabled: false }))
    assert.equal((await f.policy()).revision, 2)
    await status(await f.claim(queued), 409); await read(await f.outcome(claimed))
    const state = await f.view(); assert.equal(state.page, null); assert.equal(state.sweep, null)
    assert.equal(state.targets.find((r: CleanupTarget) => r.targetNo === queued.targetNo).state, "cancelled")
    assert.equal(state.targets.find((r: CleanupTarget) => r.targetNo === claimed.targetNo).state, "deleted")
})

test("Indexed discovery cursor is fair after deferred first twenty policies and all fifty are bounded", async t => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.open(String(30 + i))
    await status(await f.manage({ type: "configure", channelId: "90", expectedRevision: 0, ageMs: 3600000 }, f.context("10", "90")), 429)
    const first = await read(await f.work({ type: "list" })); assert.equal(first.policies.length, 20); assert.equal(first.hasMore, true)
    for (const policy of first.policies) await read(await f.work({ type: "defer", channelId: policy.channelId, expectedRevision: policy.revision, reason: "authority" }))
    const second = await read(await f.work({ type: "list", cursor: first.nextCursor })); assert.equal(second.policies.length, 20)
    assert(second.policies.every((p: { channelId: string }) => !first.policies.some((old: { channelId: string }) => old.channelId === p.channelId)))
    const third = await read(await f.work({ type: "list", cursor: second.nextCursor })); assert.equal(third.policies.length, 10); assert.equal(third.hasMore, false)
})

test("Observed absence is counted separately, and failed claimed outcomes cannot be made retryable", async t => {
    const f = await fixture(t), p = await f.prepare([f.message(), f.message(f.now() - 3600002)]), absent = p.targets[0]!, failed = p.targets[1]!
    await status(await f.outcome(absent, "absent", { noDispatch: true }), 400)
    await read(await f.outcome(absent, "absent", { noDispatch: true, observation: { messageId: absent.messageId, channelId: "30", observedAt: f.now(), status: "absent", channelVisible: true } }))
    await read(await f.reserve(failed)); await read(await f.claim(failed)); await read(await f.outcome(failed, "failed"))
    const original = (await f.view()).targets.find((r: CleanupTarget) => r.targetNo === failed.targetNo)
    assert.equal(original.noDispatch, undefined); assert.equal(original.expiresAt, undefined)
    const reassessment = await read(await f.outcome(failed, "uncertain")); assert.equal(reassessment.target.state, "failed"); assert.equal(reassessment.target.finishedAt, original.finishedAt); assert.equal(reassessment.target.reassessedAt, f.now())
    assert.equal((await read(await f.outcome(failed, "uncertain"))).recorded, false)
    const counts = (await f.view()).sweep.counts; assert.equal(counts.acknowledged, 0); assert.equal(counts.observedAbsent, 1); assert.equal(counts.unresolved, 1)
})

test("Exclusion arrays keep exact fifty-author and hundred-message bounds", async t => {
    const f = await fixture(t); await f.open()
    await f.db.run(async ctx => { const policy = (await ctx.db.query("cleanupPolicies").first())!; await ctx.db.patch(policy._id, { excludedAuthorIds: Array.from({ length: 50 }, (_, i) => String(100 + i)), excludedMessageIds: Array.from({ length: 100 }, (_, i) => String(200 + i)) }) })
    await status(await f.manage({ type: "exclude", channelId: "30", expectedRevision: 2, kind: "author", id: "9999", add: true }), 429)
    await status(await f.manage({ type: "exclude", channelId: "30", expectedRevision: 2, kind: "message", id: "9999", add: true }), 429)
    await read(await f.manage({ type: "exclude", channelId: "30", expectedRevision: 2, kind: "author", id: "100", add: true }))
    assert.equal((await f.policy()).excludedAuthorIds.length, 50)
    await read(await f.manage({ type: "exclude", channelId: "30", expectedRevision: 3, kind: "message", id: "200", add: false }))
    assert.equal((await f.policy()).excludedMessageIds.length, 99)
})

test("Target-free cycles compact their old aggregate and retained targets never pause discovery", async t => {
    const f = await fixture(t); await f.open()
    for (let i = 0; i < 3; i++) { const s = await f.start(); await read(await f.page(s.sweep, [])); await read(await f.advance(s.sweep)); f.advanceTime(60000) }
    assert.equal((await f.view()).settings.retainedSweeps, 1)
    await f.db.run(async ctx => { const settings = (await ctx.db.query("cleanupSettings").first())!; await ctx.db.patch(settings._id, { retainedTargets: 10000 }) })
    const list = await read(await f.work({ type: "list" })); assert.equal(list.settings.quotaPaused, false); assert.equal(list.policies.length, 1)
    assert.equal((await f.start()).type, "sweep")
})

test("Overlapping workers receive exactly one atomic claim capability", async t => {
    const f = await fixture(t), p = await f.prepare(), target = p.targets[0]!
    await read(await f.reserve(target))
    const responses = await Promise.all([f.claim(target), f.claim(target, f.context(), target.message, "b".repeat(32))]), claims = await Promise.all(responses.map(read))
    assert.equal(claims.filter(r => r.claimed).length, 1)
    assert.equal((await f.view()).targets[0].claimedAt, f.now())
})

test("Known unresolved publisher attempt protects its native ID without a current tracked post", async t => {
    const f = await fixture(t); await f.open(); const message = f.message()
    await f.db.run(ctx => ctx.db.insert("publishingAttempts", { serverId: "1", postNo: 1, generation: 1, sourceId: "100", actorId: "10", botId: "999", action: "send", channelId: "30", messageId: message.messageId, content: { content: "" }, canonicalContent: { content: "" }, dispatchExpiresAt: f.now() - 1000, nativeDeadlineMs: 5000, outcome: "uncertain", unresolved: true, createdAt: f.now() - 121000, finishedAt: f.now() - 1000 }))
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [message] }))
    assert.equal(preview.items[0].reason, "protected")
    const s = await f.start(), page = await read(await f.page(s.sweep, [message])); assert.equal(page.targets.length, 0); assert.equal(page.page.items[0].reason, "protected")
})
