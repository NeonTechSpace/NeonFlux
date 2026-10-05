import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import type { TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import type { AutomodRule, ModerationManageResult, ModerationEvaluateResult, ModerationCase, ModerationActionContext, ModerationActor } from "../contracts.js"
import { DAY } from "../convex/moderationDomain.ts"

const originalServer = process.env.NEONFLUX_SERVER_ID
const originalSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-moderation-secret-not-a-real-key-0000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (originalServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = originalServer; if (originalSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = originalSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/afk.ts": () => import("../convex/afk.ts"), "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"), "../convex/protection.ts": () => import("../convex/protection.ts"), "../convex/appeals.ts": () => import("../convex/appeals.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner: ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const context: ModerationActionContext = { botId: "999", botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null, botAuthorizedActions: ["log", "warn", "kick", "ban", "unban", "timeout", "untimeout", "delete", "purge", "slowmode", "lock", "unlock", "quarantine", "release"] }
function fixture(ctx: TestContext) {
    let now = 1700000000000; let sequence = 1000
    ctx.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    const post = (path: string, body: unknown, auth = true) => t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const manageRequest = (operation: unknown, actor = owner) => ({ ...source(), actor, operation })
    const manage = async (operation: unknown, actor = owner) => read<ModerationManageResult>(await post("/moderation/manage", manageRequest(operation, actor)))
    const settings = (patch: unknown) => manage({ type: "settings", patch })
    const query = (operation: unknown, actor = owner) => post("/moderation/query", { serverId: "1", actor, privateChannelVerified: true, operation })
    const action = async (type = "warn", extras: Record<string, unknown> = {}, proof: ModerationActionContext = context) => {
        const result = await manage({ type: "action", action: { type, targetId: "20", reason: "Synthetic reason", ...extras }, context: proof })
        assert.ok(!result.duplicate && result.type === "case" && result.grant)
        return { ...result, grant: result.grant }
    }
    const event = (content = "ordinary", extras: Record<string, unknown> = {}) => ({ ...source(), event: "create", userId: "20", channelId: "30", roleIds: [], content, contentHash: "a".repeat(64), mentionedUserIds: [], mentionedRoleIds: [], mentionedEveryone: false, targetIsStaff: false, context, ...extras })
    const evaluate = (content?: string, extras?: Record<string, unknown>) => post("/moderation/evaluate", event(content, extras))
    const outcome = (c: ModerationCase, result = "succeeded", extra = {}) => post("/moderation/outcome", { serverId: "1", actionId: c.actionId, caseNo: c.caseNo, outcome: result, ...extra })
    const member = (operation: unknown, requesterId = "20", extra = {}) => post("/appeals/member", { ...source(), requesterId, privateChannelVerified: true, operation, ...extra })
    const staff = (operation: unknown, extra = {}) => post("/appeals/staff", { ...source(), actor: owner, privateChannelVerified: true, operation, ...extra })
    const join = (userId = "20", extra = {}) => post("/moderation/join", { serverId: "1", userId, joinedAt: now, targetIsStaff: false, context, ...extra })
    return { t, post, source, manageRequest, manage, settings, query, action, event, evaluate, outcome, member, staff, join, now: () => now, advance: (ms: number) => { now += ms } }
}
async function read<T = Record<string, any>>(response: Response): Promise<T> { assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); return await response.json() as T }
async function status(response: Response, expected: number) { assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store"); const body = await response.json(); assert.equal(typeof body.error, "string"); assert.ok(!JSON.stringify(body).includes(secret)) }
function rule(type: AutomodRule["type"] = "words", extra: Partial<AutomodRule> = {}): AutomodRule { return { name: "test", type, enabled: true, priority: 0, action: "warn", threshold: type === "spam" ? 5 : type === "repeat" ? 3 : type === "mentions" ? 5 : 1, windowSeconds: type === "repeat" ? 30 : 10, durationSeconds: 900, patterns: ["blocked"], domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: [], ...extra } }

test("All moderation and appeals routes authenticate before input and preserve server isolation", async ctx => {
    const f = fixture(ctx)
    for (const path of ["manage", "query", "evaluate", "join", "outcome", "log-outcome", "notice-outcome", "reconcile", "observe", "gate"].map(p => `/moderation/${p}`).concat(["/appeals/member", "/appeals/staff"])) {
        await status(await f.post(path, "private synthetic malformed input", false), 401)
        await status(await f.post(path, { serverId: "2" }), 403)
    }
    await status(await f.post("/moderation/manage", { serverId: "1", content: "x".repeat(65537) }), 413)
    process.env.NEONFLUX_BOT_API_SECRET = "short"
    await status(await f.post("/moderation/manage", {}), 503)
})
test("Configuration defaults are disabled and dry-run and reject unknown or inherited patch fields", async ctx => {
    const f = fixture(ctx); const initial = await read(await f.query({ type: "settings" }))
    assert.equal(initial.settings.defcon, 3); assert.equal(initial.settings.automodEnabled, false); assert.equal(initial.settings.securityEnabled, false); assert.equal(initial.settings.automodMode, "dry-run")
    for (const patch of [{ constructor: true }, { toString: true }, { retentionDays: 29 }, { staffRoleIds: { unknown: [] } }, { joinWindowSeconds: 301 }]) await status(await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch })), 400)
    await f.settings({ staffRoleIds: { moderation: ["40"], cases: ["41"] } }); await f.settings({ staffRoleIds: { moderation: ["42"] } })
    assert.deepEqual((await read(await f.query({ type: "settings" }))).settings.staffRoleIds.cases, ["41"])
})
test("Staff role access is operation-scoped and requires native permissions and private case reads", async ctx => {
    const f = fixture(ctx); await f.settings({ staffRoleIds: { moderation: ["40"] } })
    const staff = { ...owner, userId: "11", roleIds: ["40"], isOwner: false }
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch: { defcon: 2 } }, staff)), 403)
    await status(await f.query({ type: "case-list" }, staff), 403)
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "warn", targetId: "20", reason: "Reason" }, context }, { ...staff, nativePermissionAuthorized: false })), 403)
    await f.action()
    await status(await f.post("/moderation/query", { serverId: "1", actor: owner, operation: { type: "case-list" } }), 403)
})
test("Source freshness, immutable management replay, and unsafe action contexts are rejected", async ctx => {
    const f = fixture(ctx); const body = f.manageRequest({ type: "action", action: { type: "warn", targetId: "20", reason: "Reason" }, context })
    const first = await read(await f.post("/moderation/manage", body)); assert.ok(first.grant)
    assert.deepEqual(await read(await f.post("/moderation/manage", body)), { duplicate: true })
    await status(await f.post("/moderation/manage", { ...body, messageId: "9999", createdAt: f.now() - 900001 }), 400)
    for (const proof of [{ ...context, targetProtected: true }, { ...context, botCanManageTarget: false }, { ...context, botActionAuthorized: false }]) await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "warn", targetId: "20", reason: "Reason" }, context: proof })), 403)
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "kick", targetId: owner.userId, reason: "Reason" }, context })), 403)
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "slowmode", channelId: "30", slowmodeSeconds: 21601, reason: "Reason" }, context: { ...context, currentSlowmodeSeconds: 0 } })), 400)
})
test("Action outcome, staff log, and warning notice are independent once-only bound grants", async ctx => {
    const f = fixture(ctx); await f.settings({ logChannelId: "31" }); const created = await f.action()
    const result = await read(await f.outcome(created.case)); assert.ok(result.log); assert.ok(result.notice)
    assert.deepEqual(await read(await f.outcome(created.case)), { recorded: false })
    await status(await f.outcome(created.case, "failed"), 409)
    await status(await f.post("/moderation/outcome", { serverId: "1", actionId: created.case.actionId, caseNo: created.case.caseNo + 1, outcome: "succeeded" }), 409)
    for (const [path, idField] of [["log-outcome", "logId"], ["notice-outcome", "noticeId"]] as const) {
        const body = { serverId: "1", [idField]: created.case.actionId, caseNo: created.case.caseNo, outcome: "uncertain" }
        assert.deepEqual(await read(await f.post(`/moderation/${path}`, body)), { recorded: true }); assert.deepEqual(await read(await f.post(`/moderation/${path}`, body)), { recorded: false })
    }
    const queried = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo })); assert.equal(queried.case.outcome, "succeeded"); assert.equal(queried.case.notificationOutcome, "uncertain"); assert.equal(queried.case.logOutcome, "uncertain")
})
test("Case corrections preserve attribution and warning void produces a linked audit generation", async ctx => {
    const f = fixture(ctx); const created = await f.action(); await f.outcome(created.case)
    const corrected = await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: "Corrected" }); assert.ok(!corrected.duplicate && corrected.type === "case"); assert.equal(corrected.case.corrections[0]?.previousReason, "Synthetic reason"); assert.equal(corrected.case.corrections[0]?.actorId, owner.userId)
    const voided = await f.manage({ type: "case-void", caseNo: created.case.caseNo }); assert.ok(!voided.duplicate && voided.type === "case" && voided.grant); assert.equal(voided.case.linkedCaseNo, created.case.caseNo)
    assert.equal((await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.voided, true)
})
test("Timeout ownership preserves stronger and prior sanctions and superseded generations", async ctx => {
    const f = fixture(ctx); const prior = new Date(f.now() + 300000).toISOString()
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Reason" }, context: { ...context, currentTimeoutUntil: prior } })), 409)
    const created = await f.action("quarantine", { durationSeconds: 900 }, { ...context, currentTimeoutUntil: prior })
    const expected = new Date(f.now() + 900000).toISOString(); await read(await f.outcome(created.case, "succeeded", { timeoutUntil: expected }))
    const recovery = (await read(await f.query({ type: "recovery-target", targetId: "20" }))).recovery
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "release", targetId: "20", recoveryId: recovery.recoveryId, reason: "Release" }, context: { ...context, currentTimeoutUntil: expected, recoveryGeneration: recovery.generation } })), 409)
    f.advance(300001)
    const next = await f.action("timeout", { durationSeconds: 1200 }, { ...context, currentTimeoutUntil: expected }); const newerExpiry = new Date(f.now() + 1200000).toISOString(); await read(await f.outcome(next.case, "succeeded", { timeoutUntil: newerExpiry }))
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "release", targetId: "20", recoveryId: recovery.recoveryId, reason: "Stale" }, context: { ...context, currentTimeoutUntil: expected, recoveryGeneration: recovery.generation } })), 409)
})
test("Lock recovery restores only owned bits and preserves unrelated staff overwrite changes", async ctx => {
    const f = fixture(ctx); const locked = await f.action("lock", { targetId: undefined, channelId: "30" }, { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } })
    await read(await f.outcome(locked.case)); const recovery = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const unlocked = await f.action("unlock", { targetId: undefined, channelId: "30", recoveryId: recovery.recoveryId }, { ...context, currentOverwrite: { exists: true, allow: "1024", deny: "2048" }, recoveryGeneration: recovery.generation })
    assert.deepEqual(unlocked.grant.overwrite, { exists: true, allow: "1024", deny: "0" }); assert.equal(unlocked.grant.expectedOverwrite?.deny, "2048")
    await read(await f.outcome(unlocked.case)); await status(await f.query({ type: "recovery-channel", channelId: "30" }), 404)
})
test("Restart observation consumes pending outcomes, blocks stale dispatch and reconciliation is observational", async ctx => {
    const f = fixture(ctx); const created = await f.action("timeout", { durationSeconds: 900 })
    const dispatch = { serverId: "1", actionId: created.case.actionId, caseNo: created.case.caseNo, dispatch: true }
    assert.deepEqual(await read(await f.post("/moderation/outcome", dispatch)), { recorded: false })
    f.advance(1000); const observed = await read(await f.post("/moderation/observe", { serverId: "1" })); assert.equal(observed.uncertainActions, 1)
    await status(await f.post("/moderation/outcome", dispatch), 409)
    await status(await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() }), 409)
    const body = { ...f.source(), actor: owner, privateChannelVerified: true, actionId: created.case.actionId, observation: { observedAt: f.now(), timeoutUntil: null } }
    const reconciled = await read(await f.post("/moderation/reconcile", body)); assert.equal(reconciled.case.outcome, "uncertain"); assert.equal(reconciled.recorded, true)
    const older = { ...f.source(), actor: owner, privateChannelVerified: true, actionId: created.case.actionId, observation: { observedAt: f.now() - 1, timeoutUntil: new Date(f.now() + 900000).toISOString() } }; assert.equal((await read(await f.post("/moderation/reconcile", older))).recorded, false)
})
test("Dispatch confirmation is a one-time claim of the pending grant", async ctx => {
    const f = fixture(ctx); const created = await f.action("kick")
    const dispatch = { serverId: "1", actionId: created.case.actionId, caseNo: created.case.caseNo, dispatch: true }
    assert.deepEqual(await read(await f.post("/moderation/outcome", dispatch)), { recorded: false })
    await status(await f.post("/moderation/outcome", dispatch), 409)
    assert.equal((await read(await f.outcome(created.case))).recorded, true)
})
test("Startup sweep continuations keep the startup cutoff and leave current actions pending", async ctx => {
    const f = fixture(ctx); const interrupted = await f.action(); const cutoff = f.now()
    f.advance(1000); const current = await f.action()
    await f.t.mutation(internal.moderation.observe, { request: { serverId: "1", cutoff } })
    assert.equal((await read(await f.query({ type: "case-show", caseNo: interrupted.case.caseNo }))).case.outcome, "uncertain")
    assert.equal((await read(await f.query({ type: "case-show", caseNo: current.case.caseNo }))).case.outcome, "pending")
})
test("DEFCON blocks public commands and keeps only explicit administrator recovery at level one", async ctx => {
    const f = fixture(ctx); await f.settings({ defcon: 2 })
    const gate = async (command: string, who = owner) => read(await f.post("/moderation/gate", { serverId: "1", actor: who, command }))
    assert.equal((await gate("public")).allowed, false); assert.equal((await gate("staff")).allowed, true); assert.equal((await gate("appeal", { ...owner, isOwner: false })).allowed, true)
    await f.settings({ defcon: 1 }); assert.equal((await gate("staff")).allowed, false); assert.equal((await gate("critical")).allowed, true)
    await status(await f.member({ type: "list" }), 403)
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "kick", targetId: "20", reason: "Reason" }, context })), 403)
    await f.settings({ defcon: 3 })
})
test("Rules validate canonical configuration and module off prevents sanctions", async ctx => {
    const f = fixture(ctx); await f.manage({ type: "rule-create", rule: rule() })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked"))).grant, undefined)
    await f.settings({ automodEnabled: true }); const dry = await read<ModerationEvaluateResult>(await f.evaluate("blocked")); assert.equal(dry.grant?.action, "log"); assert.equal(dry.blocked, false)
    await f.manage({ type: "rule-update", name: "test", patch: { priority: 100, enabled: false } }); assert.equal((await read(await f.query({ type: "rule-show", name: "test" }))).rule.enabled, false)
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "rule-update", name: "test", patch: { constructor: true } })), 400)
    await f.manage({ type: "rule-delete", name: "test" }); await status(await f.query({ type: "rule-show", name: "test" }), 404)
})
test("Automod edits reevaluate no-match but never punish the same source twice or count edit spam", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule() })
    const body = f.event("ordinary"); assert.equal((await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body))).grant, undefined)
    f.advance(1); const edited = { ...body, event: "edit", editedAt: f.now(), content: "blocked", contentHash: "b".repeat(64) }
    const hit = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", edited)); assert.equal(hit.grant?.action, "warn")
    f.advance(1); assert.equal((await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", { ...edited, editedAt: f.now(), contentHash: "c".repeat(64) }))).duplicate, true)
    assert.equal((await f.t.run(ctx => ctx.db.query("automodWindows").collect())).length, 1)
})
test("Old source creation may have a fresh edit, while stale edit timestamps cannot replace newer observations", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true }); await f.manage({ type: "rule-create", rule: rule() })
    const old = f.event("ordinary", { event: "edit", createdAt: f.now() - DAY, editedAt: f.now() }); await read(await f.post("/moderation/evaluate", old))
    await status(await f.post("/moderation/evaluate", { ...old, messageId: "5000", editedAt: f.now() - 900001 }), 400)
    const newer = { ...old, editedAt: f.now() + 1 }; await read(await f.post("/moderation/evaluate", newer))
    assert.equal((await read(await f.post("/moderation/evaluate", { ...old, content: "blocked", contentHash: "b".repeat(64) }))).duplicate, true)
})
test("Spam and repeat windows count creates atomically with bounded expiry", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule("spam", { threshold: 2 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined); assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
    f.advance(11000); assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined)
    await f.manage({ type: "rule-delete", name: "test" }); await f.manage({ type: "rule-create", rule: rule("repeat", { threshold: 2 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
})
test("Spam windows count only the rule's qualifying channels before stopping", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule("spam", { threshold: 2, channelIds: ["30"] }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined)
    await f.t.run(async ctx => { for (let i = 0; i < 1000; i++) await ctx.db.insert("automodWindows", { serverId: "1", userId: "20", channelId: "40", kind: "message", contentHash: "b".repeat(64), timestamp: f.now(), expiresAt: f.now() + 300000 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
})
test("Mention rules count unique users, roles, and explicit everyone without inventing unknown flags", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule("mentions", { threshold: 3 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("text", { mentionedUserIds: ["31", "31"], mentionedRoleIds: ["40", "41"] }))).grant?.action, "warn")
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("text", { mentionedRoleIds: null, mentionedEveryone: null }))).grant, undefined)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("text", { mentionedEveryone: true }))).grant?.action, "warn")
})
test("Domain rules honor uppercase WWW, subdomain boundaries, punctuation, and explicit allowlists", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule("domains", { patterns: ["evil.test"] }) })
    for (const content of ["WWW.evil.test", "https://sub.evil.test)"]) assert.ok((await read<ModerationEvaluateResult>(await f.evaluate(content))).grant)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("https://notevil.test"))).grant, undefined)
    await f.manage({ type: "rule-update", name: "test", patch: { domainMode: "allow", patterns: ["allowed.test"] } })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("no links"))).grant, undefined); assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("https://sub.allowed.test"))).grant, undefined)
    assert.ok((await read<ModerationEvaluateResult>(await f.evaluate("https://other.test"))).grant)
})
test("Rules use priority and deterministic names, scopes and exemptions, and one sanction", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule("words", { name: "z", priority: 10 }) }); await f.manage({ type: "rule-create", rule: rule("words", { name: "a", priority: 10, channelIds: ["30"], exemptRoleIds: ["40"] }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked"))).case?.ruleName, "a")
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked", { roleIds: ["40"] }))).case?.ruleName, "z")
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked", { targetIsStaff: true }))).grant, undefined)
})
test("Honeypot enforcement takes one reservation shared with automod and records one honeypot case", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce", securityEnabled: true, securityMode: "enforce", honeypotEnabled: true, honeypotChannelIds: ["30"] }); await f.manage({ type: "rule-create", rule: rule() })
    const body = f.event("blocked"); const hit = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body)); assert.equal(hit.grant?.action, "quarantine"); assert.equal(hit.case?.origin, "security"); assert.equal(hit.case?.incident, "honeypot")
    assert.equal((await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body))).duplicate, true)
    assert.equal((await f.t.run(ctx => ctx.db.query("moderationCases").collect())).length, 1)
})
test("Join bursts are deduplicated and cannot automatically set DEFCON one", async ctx => {
    const f = fixture(ctx); await f.settings({ securityEnabled: true, securityMode: "enforce", joinEnabled: true, joinThreshold: 2, joinDefcon2: true })
    assert.equal((await read(await f.join("20"))).case, undefined); const hit = await read(await f.join("21")); assert.equal(hit.settings.defcon, 2); assert.equal(hit.case.incident, "join-burst")
    assert.equal((await read(await f.join("21"))).duplicate, true); assert.equal((await read(await f.join("22"))).case, undefined)
    // A later burst outside the window opens a new case
    f.advance(11000); await read(await f.join("23")); assert.equal((await read(await f.join("24"))).case.incident, "join-burst")
})
test("Watchlist joins log locally and watchlist narratives require private reads", async ctx => {
    const f = fixture(ctx); await f.manage({ type: "watchlist-add", userId: "20", reason: "Private synthetic note" }); await f.settings({ securityEnabled: true, watchlistEnabled: true })
    const hit = await read(await f.join()); assert.equal(hit.grant.action, "log"); assert.equal(hit.case.incident, "watchlist"); assert.ok(!JSON.stringify(hit).includes("Private synthetic note"))
    await status(await f.post("/moderation/query", { serverId: "1", actor: owner, operation: { type: "watchlist-list" } }), 403)
    await f.manage({ type: "watchlist-remove", userId: "20" })
})
test("Appeals are actor-bound private, discover own cases, and decision never reverses sanction", async ctx => {
    const f = fixture(ctx); const created = await f.action("ban"); await read(await f.outcome(created.case))
    await status(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" }, "21"), 404)
    await status(await f.member({ type: "list" }, "20", { privateChannelVerified: false }), 403)
    const cases = await read(await f.member({ type: "cases" })); assert.equal(cases.cases[0].caseNo, created.case.caseNo); assert.equal(cases.cases[0].corrections, undefined); assert.equal(cases.cases[0].actorId, undefined)
    const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" })); await status(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Second" }), 409)
    await status(await f.member({ type: "show", appealNo: opened.appeal.appealNo }, "21"), 404)
    const decided = await read(await f.staff({ type: "decide", appealNo: opened.appeal.appealNo, decision: "accepted", reason: "Review accepted" })); assert.equal(decided.appeal.status, "accepted")
    assert.equal((await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.outcome, "succeeded")
    assert.equal((await read(await f.query({ type: "recovery-list" }))).recoveries[0].type, "ban")
})
test("Owner erasure redacts all selected narratives without affecting another case or active recovery", async ctx => {
    const f = fixture(ctx); const created = await f.action("timeout", { durationSeconds: 900 }); await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() }); const other = await f.action()
    await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: "Corrected private reason" }); const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" }))
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "erase", caseNo: created.case.caseNo }, { ...owner, isOwner: false, isAdministrator: true })), 403)
    await f.manage({ type: "erase", caseNo: created.case.caseNo }); const erased = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo })); assert.equal(erased.case.reason, "[Erased by owner]"); assert.deepEqual(erased.case.corrections, [])
    assert.equal((await f.t.run(ctx => ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", "1").eq("caseNo", created.case.caseNo)).unique()))?.grant?.reason, "[Erased by owner]")
    assert.equal((await read(await f.member({ type: "show", appealNo: opened.appeal.appealNo }))).appeal.text, "[Erased by owner]")
    assert.equal((await read(await f.query({ type: "case-show", caseNo: other.case.caseNo }))).case.erased, false); assert.equal((await read(await f.query({ type: "recovery-target", targetId: "20" }))).recovery.status, "active")
})
test("Audit expiry protects active recovery and open appeals, and known timeout expiry retires only metadata", async ctx => {
    const f = fixture(ctx); const timeoutCase = await f.action("timeout", { durationSeconds: 60 }); await f.outcome(timeoutCase.case, "succeeded", { timeoutUntil: new Date(f.now() + 60000).toISOString() })
    f.advance(60001); await f.t.mutation(internal.moderation.cleanup, {}); await status(await f.query({ type: "recovery-target", targetId: "20" }), 404)
    const ban = await f.action("ban"); await f.outcome(ban.case); const warning = await f.action(); await f.outcome(warning.case); await f.member({ type: "submit", caseNo: warning.case.caseNo, text: "Appeal stays open" })
    f.advance(181 * DAY); await f.t.mutation(internal.moderation.cleanup, {})
    await read(await f.query({ type: "case-show", caseNo: ban.case.caseNo })); await read(await f.query({ type: "case-show", caseNo: warning.case.caseNo })); await status(await f.query({ type: "case-show", caseNo: timeoutCase.case.caseNo }), 404)
})

test("More than thirty-two harmless edits still allow one later content sanction", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("ordinary"); await read(await f.post("/moderation/evaluate", original))
    for (let i = 0; i < 35; i++) { f.advance(1); await read(await f.post("/moderation/evaluate", { ...original, event: "edit", editedAt: f.now(), contentHash: i.toString(16).padStart(64, "0") })) }
    f.advance(1); const result = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", { ...original, event: "edit", editedAt: f.now(), content: "blocked", contentHash: "f".repeat(64) }))
    assert.equal(result.grant?.action, "warn"); assert.equal(result.blocked, true)
})
test("Retained source cases prevent repeated punishment after receipt expiry and keep blocking replay", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("blocked actual synthetic source content"); const result = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", original)); assert.ok(result.case)
    f.advance(DAY + 1); await f.t.mutation(internal.moderation.cleanup, {})
    const replay = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", { ...original, event: "edit", editedAt: f.now(), contentHash: "b".repeat(64) }))
    assert.equal(replay.duplicate, true); assert.equal(replay.blocked, true); assert.equal(replay.grant, undefined)
    const stored = await f.t.run(async ctx => [...await ctx.db.query("moderationCases").collect(), ...await ctx.db.query("automodWindows").collect(), ...await ctx.db.query("moderationReceipts").collect()])
    assert.ok(!JSON.stringify(stored).includes(original.content))
})
test("Failed reversal preserves active ownership with a new generation and supports explicit fresh retry", async ctx => {
    const f = fixture(ctx); const locked = await f.action("lock", { targetId: undefined, channelId: "30" }, { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } }); await read(await f.outcome(locked.case))
    const original = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const reverse = await f.action("unlock", { targetId: undefined, channelId: "30", recoveryId: original.recoveryId }, { ...context, currentOverwrite: original.expectedOverwrite, recoveryGeneration: original.generation })
    assert.equal(reverse.case.linkedCaseNo, original.caseNo); await read(await f.outcome(reverse.case, "failed"))
    const current = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    assert.equal(current.status, "active"); assert.equal(current.generation, reverse.case.caseNo); assert.ok(!Object.hasOwn(current, "reversalState"))
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "unlock", channelId: "30", recoveryId: original.recoveryId, reason: "Stale" }, context: { ...context, currentOverwrite: original.expectedOverwrite, recoveryGeneration: original.generation } })), 409)
    const retried = await f.action("unlock", { targetId: undefined, channelId: "30", recoveryId: current.recoveryId }, { ...context, currentOverwrite: current.expectedOverwrite, recoveryGeneration: current.generation }); await read(await f.outcome(retried.case))
    assert.equal((await f.t.run(ctx => ctx.db.query("securityRecoveries").collect())).length, 0)
})
test("Uncertain applied unlock can retire observed restored ownership without inferring sanction outcome", async ctx => {
    const f = fixture(ctx); const locked = await f.action("lock", { targetId: undefined, channelId: "30" }, { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } }); await read(await f.outcome(locked.case))
    const original = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const reverse = await f.action("unlock", { targetId: undefined, channelId: "30", recoveryId: original.recoveryId }, { ...context, currentOverwrite: original.expectedOverwrite, recoveryGeneration: original.generation }); await read(await f.outcome(reverse.case, "uncertain"))
    const observed = await read(await f.post("/moderation/reconcile", { ...f.source(), actor: owner, privateChannelVerified: true, actionId: reverse.case.actionId, observation: { observedAt: f.now(), overwrite: { exists: false, allow: "0", deny: "0" } } }))
    assert.equal(observed.case.outcome, "uncertain"); await status(await f.query({ type: "recovery-channel", channelId: "30" }), 404)
})
test("Security-only staff may manage and reconcile security recovery without unrelated case access", async ctx => {
    const f = fixture(ctx); await f.settings({ staffRoleIds: { security: ["40"] } }); const staff = { ...owner, userId: "11", roleIds: ["40"], isOwner: false }
    const created = await f.manage({ type: "action", action: { type: "quarantine", targetId: "20", reason: "Security", durationSeconds: 900 }, context }, staff); assert.ok(!created.duplicate && created.type === "case")
    await read(await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() }))
    await read(await f.query({ type: "recovery-case", caseNo: created.case.caseNo }, staff)); await status(await f.query({ type: "case-show", caseNo: created.case.caseNo }, staff), 403)
    await read(await f.post("/moderation/reconcile", { ...f.source(), actor: staff, privateChannelVerified: true, actionId: created.case.actionId, observation: { observedAt: f.now(), timeoutUntil: new Date(f.now() + 900000).toISOString() } }))
})
test("Indexed case cursors provide bounded complete navigation and private own-case summaries", async ctx => {
    const f = fixture(ctx); for (let i = 0; i < 13; i++) await f.action()
    const first = await read(await f.query({ type: "case-list" })); assert.equal(first.cases.length, 10); assert.ok(first.nextBeforeCaseNo)
    const next = await read(await f.query({ type: "case-list", beforeCaseNo: first.nextBeforeCaseNo })); assert.equal(next.cases.length, 3); assert.equal(next.nextBeforeCaseNo, undefined)
    assert.equal(new Set([...first.cases, ...next.cases].map(c => c.caseNo)).size, 13)
    const own = await read(await f.member({ type: "cases" })); assert.equal(own.cases.length, 10); assert.ok(own.nextBeforeCaseNo); assert.deepEqual(Object.keys(own.cases[0]).sort(), ["action", "caseNo", "createdAt", "outcome", "reason"])
})
test("Closed appeals keep their linked cases until the appeal's own retention ends", async ctx => {
    const f = fixture(ctx); const created = await f.action(); await f.outcome(created.case)
    f.advance(179 * DAY); const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Late appeal" })); await read(await f.staff({ type: "decide", appealNo: opened.appeal.appealNo, decision: "rejected", reason: "Decision" }))
    f.advance(2 * DAY); await f.t.mutation(internal.moderation.cleanup, {}); await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    f.advance(180 * DAY); await f.t.mutation(internal.moderation.cleanup, {}); await status(await f.query({ type: "case-show", caseNo: created.case.caseNo }), 404)
})
test("Restart marks reserved deliveries uncertain and never resends", async ctx => {
    const f = fixture(ctx); await f.settings({ logChannelId: "31" }); const created = await f.action(); f.advance(59000); await f.outcome(created.case); f.advance(2000)
    const before = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo })); assert.equal(before.case.logOutcome, "pending"); assert.equal(before.case.notificationOutcome, "pending")
    await read(await f.post("/moderation/observe", { serverId: "1" })); const after = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo })); assert.equal(after.case.logOutcome, "uncertain"); assert.equal(after.case.notificationOutcome, "uncertain"); assert.equal(after.case.outcome, "succeeded")
    assert.deepEqual(await read(await f.outcome(created.case)), { recorded: false })
})
test("Manual module off blocks new sanctions but preserves case reads and explicit reversals", async ctx => {
    const f = fixture(ctx); const created = await f.action("ban"); await f.outcome(created.case); await f.settings({ manualModerationEnabled: false })
    await status(await f.post("/moderation/manage", f.manageRequest({ type: "action", action: { type: "warn", targetId: "20", reason: "Blocked" }, context })), 403)
    await read(await f.query({ type: "case-show", caseNo: created.case.caseNo })); await f.action("unban", { linkedCaseNo: created.case.caseNo })
    assert.equal((await read(await f.query({ type: "settings" }))).settings.automodEnabled, false)
})
test("A genuinely fresh edit may be evaluated after audit history expires but stale originals remain rejected", async ctx => {
    const f = fixture(ctx); await f.settings({ automodEnabled: true, automodMode: "enforce" }); await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("blocked"); const first = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", original)); assert.ok(first.case); await f.outcome(first.case)
    f.advance(181 * DAY); await f.t.mutation(internal.moderation.cleanup, {})
    await status(await f.post("/moderation/evaluate", original), 400)
    const edited = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", { ...original, event: "edit", editedAt: f.now(), contentHash: "c".repeat(64) }))
    assert.equal(edited.grant?.action, "warn"); assert.ok(edited.case && edited.case.caseNo > first.case.caseNo)
})
