import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import type { ModerationActor, RolesEvaluateOperation, RolesEvaluateResult, RolesGrant, RolesMapping, RolesMemberContext, RolesPanel, RolesWithdrawal } from "../contracts.js"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { ROLES_DAY } from "../convex/rolesDomain.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-roles-secret-not-a-real-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/roles.ts": () => import("../convex/roles.ts"), "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"), "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/roleReactions.ts": () => import("../convex/roleReactions.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner: ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const joinedAt = "2023-11-14T22:13:19.000000Z"
const snapshots = Array.from({ length: 40 }, (_, index) => ({ roleId: String(40 + index), permissions: "0", botCanManage: true, actorCanManage: true }))
const context: RolesMemberContext = { userId: "20", joinedAt, roleIds: [], isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles: snapshots }
const mapping = (roleId = "40", emoji = "✅"): RolesMapping => ({ roleId, emoji, prerequisiteRoleIds: [], exclusionRoleIds: [] })
function fixture(test: TestContext) {
    let now = 1700000000000, sequence = 1000, post = 0
    test.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const rawHttp = (route: string, body: unknown, auth = true) => t.fetch(route, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const http = async (route: string, body: any, auth = true): Promise<Response> => {
        return rawHttp(route, body, auth)
    }
    const manageRequest = (operation: unknown, actor = owner) => ({ ...source(), actor, operation })
    const manage = (operation: unknown, actor = owner) => http("/roles/manage", manageRequest(operation, actor))
    const query = (operation: unknown, actor = owner) => http("/roles/query", { serverId: "1", actor, operation })
    const evaluation = (operation: RolesEvaluateOperation, member = context, extra = {}) => ({ serverId: "1", sourceId: String(++sequence), createdAt: operation.type === "join" ? Date.parse(member.joinedAt) : now, context: member, operation, ...extra })
    const evaluate = (operation: RolesEvaluateOperation, member = context, extra = {}) => http("/roles/evaluate", evaluation(operation, member, extra))
    const memberQuery = (member = context) => http("/roles/member-query", { serverId: "1", context: member })
    const settings = (patch: unknown) => manage({ type: "settings", patch, roles: snapshots })
    const create = async (name = "colors", maps = [mapping()], kind = "reaction", exclusive = false) => {
        const result = await read(await manage({ type: "panel-create", name, kind, mappings: maps, exclusive, roles: snapshots })); return result.panel as RolesPanel
    }
    const publish = async (panel: RolesPanel) => {
        const draftName = `synthetic_${++post}`
        const pub = (operation: unknown) => http("/publishing/manage", manageRequest(operation))
        await read(await pub({ type: "draft-create", kind: "draft", name: draftName }))
        await read(await pub({ type: "draft-update", kind: "draft", name: draftName, expectedRevision: 1, edit: { type: "content", content: "Synthetic role panel" } }))
        const result = await read(await pub({ type: "send", kind: "draft", name: draftName, expectedRevision: 2, channelId: "30", context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } }))
        const grant = result.grant, claimToken = grant.sourceId.padStart(32, "0"), binding = { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, sourceId: grant.sourceId, generation: grant.generation }
        await read(await http("/publishing/dispatch", { ...binding, claimToken }))
        await read(await http("/publishing/outcome", { ...binding, claimToken, outcome: "sent", messageId: String(10000 + post) }))
        return (await read(await manage({ type: "panel-bind", name: panel.name, expectedRevision: panel.revision, postNo: grant.postNo, expectedPostGeneration: 1 }))).panel as RolesPanel
    }
    const ready = async (name = "colors", maps = [mapping()], kind = "reaction", exclusive = false) => publish(await create(name, maps, kind, exclusive))
    const choose = (panel: RolesPanel, roleId = "40", selected = true, member = context) => evaluate({ type: "choose", name: panel.name, revision: panel.published!.revision, roleId, selected }, member)
    const token = (grant: RolesGrant) => grant.sourceId.replace(/[^a-f0-9]/g, "0").slice(-32).padStart(32, "0")
    const binding = (grant: RolesGrant) => ({ serverId: "1", attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId })
    const dispatch = (grant: RolesGrant, member = context, extra = {}) => http("/roles/dispatch", { ...binding(grant), claimToken: token(grant), context: member, actor: owner, ...extra })
    const outcome = (grant: RolesGrant, value = "succeeded", extra = {}) => http("/roles/outcome", { ...binding(grant), claimToken: token(grant), outcome: value, ...extra })
    const applied = async (grant: RolesGrant, member = context) => { assert.equal((await read(await dispatch(grant, member))).claimed, true); await read(await outcome(grant)); return { ...member, roleIds: grant.action === "add" ? [...member.roleIds, grant.roleId] : member.roleIds.filter(x => x !== grant.roleId) } }
    const claims = async (member = context) => (await read(await query({ type: "claim-list", userId: member.userId, joinedAt: member.joinedAt }))).claims
    const withdrawal = async (panel: RolesPanel, deletePanel = false) => (await read(await manage({ type: "withdraw", name: panel.name, revision: panel.published?.revision ?? panel.revision, deletePanel }))).withdrawal as RolesWithdrawal
    return { t, http, rawHttp, manageRequest, manage, query, source, evaluation, evaluate, memberQuery, settings, create, publish, ready, choose, dispatch, outcome, binding, token, applied, claims, withdrawal, advance: (ms: number) => { now += ms }, now: () => now }
}
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal(response.headers.get("cache-control"), "no-store"); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected); const body = JSON.stringify(await response.json()); assert.equal(body.includes(secret), false); assert.equal(body.includes("Synthetic private"), false) }
test("User ID reservations join default roles, persist across rejoin and never grant another user's reservation", async test => {
    const f = fixture(test)
    const saved = await read(await f.settings({ autoroleIds: ["40"], reservations: [{ userId: "20", roleIds: ["40", "41"] }, { userId: "21", roleIds: ["42"] }], autoroleEnabled: true }))
    assert.equal(saved.settings.revision, 2)
    const source = f.evaluation({ type: "join" })
    const first = await grant(await f.http("/roles/evaluate", source))
    assert.equal(first.roleId, "40")
    let member = await f.applied(first)
    const second = await grant(await f.http("/roles/evaluate", { ...source, context: member, continuationAttemptId: first.attemptId }))
    assert.equal(second.roleId, "41")
    member = await f.applied(second, member)
    const done = await read(await f.http("/roles/evaluate", { ...source, context: member, continuationAttemptId: second.attemptId }))
    assert.equal(done.grant, undefined)
    assert.deepEqual(member.roleIds, ["40", "41"])
    const other = await grant(await f.evaluate({ type: "join" }, { ...context, userId: "22" }))
    assert.equal(other.roleId, "40")
    const rejoined = { ...context, joinedAt: "2023-11-14T22:13:20.000000Z", roleIds: ["40"] }
    const replacement = await grant(await f.evaluate({ type: "join" }, rejoined))
    assert.equal(replacement.roleId, "41")
    assert.equal(replacement.joinedAt, rejoined.joinedAt)
    assert.notEqual(replacement.ownershipId, second.ownershipId)
    assert.deepEqual((await read(await f.query({ type: "settings" }))).settings.reservations, saved.settings.reservations)
})

test("Reservations share disabled, human, verification, timeout and exact membership gates", async test => {
    const f = fixture(test)
    await read(await f.settings({ reservations: [{ userId: "20", roleIds: ["41"] }] }))
    assert.equal((await read(await f.evaluate({ type: "join" }))).grant, undefined)
    await read(await f.settings({ autoroleEnabled: true }))
    assert.equal((await read(await f.evaluate({ type: "join" }, { ...context, isBot: true }))).grant, undefined)
    await status(await f.evaluate({ type: "join" }, { ...context, timeoutUntil: new Date(f.now() + 60000).toISOString() }), 403)
    const request = f.evaluation({ type: "join" })
    await status(await f.http("/roles/evaluate", { ...request, createdAt: request.createdAt - 1 }), 400)
    await f.ready("rules", [mapping("40")], "verification")
    await status(await f.evaluate({ type: "join" }), 403)
})

test("Reservation configuration rejects duplicate users, empty roles, unknown IDs and every unsafe role", async test => {
    const f = fixture(test)
    for (const reservations of [[{ userId: "20", roleIds: [] }], [{ userId: "0", roleIds: ["40"] }], [{ userId: "20", roleIds: ["40"] }, { userId: "20", roleIds: ["41"] }], Array.from({ length: 101 }, (_, index) => ({ userId: String(20 + index), roleIds: ["40"] }))]) await status(await f.settings({ reservations }), 400)
    for (const roleId of ["1", "9999"]) await status(await f.settings({ reservations: [{ userId: "20", roleIds: [roleId] }] }), 403)
    for (const patch of [{ permissions: "8" }, { botCanManage: false }, { actorCanManage: false }]) await status(await f.manage({ type: "settings", patch: { reservations: [{ userId: "20", roleIds: ["41"] }] }, roles: snapshots.map(role => role.roleId === "41" ? { ...role, ...patch } : role) }), 403)
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["41"] } } })))
    await status(await f.settings({ reservations: [{ userId: "20", roleIds: ["41"] }] }), 403)
})

test("Reservation removal retains claims and staff protections until explicit withdrawal and preserves unowned roles", async test => {
    const f = fixture(test)
    const saved = await read(await f.settings({ reservations: [{ userId: "20", roleIds: ["41"] }], autoroleEnabled: true }))
    const member = { ...context, roleIds: ["41", "79"] }
    assert.equal((await read(await f.evaluate({ type: "join" }, member))).grant, undefined)
    await status(await f.manage({ type: "autorole-withdraw", revision: saved.settings.revision }), 409)
    await read(await f.settings({ reservations: [] }))
    await status(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["41"] } } })), 409)
    const withdrawn = await read(await f.manage({ type: "autorole-withdraw", revision: saved.settings.revision }))
    assert.equal(withdrawn.withdrawal.status, "complete")
    assert.deepEqual(member.roleIds, ["41", "79"])
    assert.equal((await f.claims(member)).length, 0)
    assert.equal((await read(await f.evaluate({ type: "join" }, { ...member, joinedAt: "2023-11-14T22:13:20Z" }))).grant, undefined)
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["41"] } } })))
})

test("Disabling, reservation edits, user changes and native role drift invalidate pending reservation dispatch", async test => {
    for (const change of ["disabled", "removed", "user", "epoch", "unsafe"] as const) {
        const f = fixture(test)
        await read(await f.settings({ reservations: [{ userId: "20", roleIds: ["41"] }], autoroleEnabled: true }))
        const reserved = await grant(await f.evaluate({ type: "join" }))
        if (change === "disabled") await read(await f.settings({ autoroleEnabled: false }))
        if (change === "removed") await read(await f.settings({ reservations: [] }))
        const member = change === "user" ? { ...context, userId: "21" } : change === "epoch" ? { ...context, joinedAt: "2023-11-14T22:13:20Z" } : change === "unsafe" ? { ...context, roles: snapshots.map(role => role.roleId === "41" ? { ...role, permissions: "8" } : role) } : context
        await status(await f.dispatch(reserved, member), change === "epoch" || change === "user" ? 409 : 403)
    }
})

test("Reservation configuration references withdraw in bounded pages beyond twenty roles", async test => {
    const f = fixture(test)
    const saved = await read(await f.settings({ reservations: [{ userId: "20", roleIds: snapshots.slice(0, 20).map(role => role.roleId) }, { userId: "21", roleIds: snapshots.slice(20).map(role => role.roleId) }] }))
    await read(await f.settings({ reservations: [] }))
    const first = (await read(await f.manage({ type: "autorole-withdraw", revision: saved.settings.revision }))).withdrawal
    assert.equal(first.status, "pending")
    assert.equal(first.remainingAtLeast, 19)
    assert.equal(first.hasMore, true)
    const second = (await read(await f.manage({ type: "withdraw-next", withdrawalId: first.withdrawalId, expectedStep: first.step }))).withdrawal
    assert.equal(second.status, "complete")
    const references = await f.t.run(ctx => ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", "1").eq("consumerKey", `autorole:${saved.settings.revision}`)).collect())
    assert.deepEqual(references, [])
})
async function grant(response: Response): Promise<RolesGrant> { const result = await read(response); assert(result.grant); return result.grant }

test("Role routes authenticate first, bind the configured server and expose disabled defaults without creating state", async test => {
    const f = fixture(test)
    for (const path of ["manage", "query", "policy", "member-query", "reaction-jobs", "evaluate", "dispatch", "outcome", "reconcile", "observe"]) { await status(await f.http(`/roles/${path}`, "Synthetic private malformed body", false), 401); await status(await f.http(`/roles/${path}`, { serverId: "2" }), 403) }
    const result = await read(await f.query({ type: "settings" })); assert.deepEqual(result.settings, { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 })
    assert.equal((await f.t.run(c => c.db.query("roleSettings").collect())).length, 0)
    await status(await f.manage({ type: "panel-create", name: "colors", kind: "reaction" }, { ...owner, isOwner: false }), 403)
    await status(await f.settings({ constructor: true }), 400)
    await status(await f.http("/roles/manage", { serverId: "1", private: "x".repeat(262145) }), 413)
})
test("Role configuration rejects privileged, unknown, everyone, inaccessible and staff roles including zero permissions", async test => {
    const f = fixture(test)
    for (const roles of [[{ ...snapshots[0], roleId: "1" }], [{ ...snapshots[0], permissions: "8" }], [{ ...snapshots[0], permissions: String(1n << 60n) }], [{ ...snapshots[0], botCanManage: false }], [{ ...snapshots[0], actorCanManage: false }]]) {
        await status(await f.manage({ type: "panel-create", name: "bad", kind: "reaction", mappings: [mapping(roles[0]!.roleId)], roles }), 403)
    }
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["40"] } } })))
    await status(await f.manage({ type: "panel-create", name: "staff", kind: "reaction", mappings: [mapping()], roles: snapshots }), 403)
    await status(await f.settings({ autoroleIds: ["40"] }), 403)
    await status(await f.manage({ type: "panel-create", name: "duplicate", kind: "reaction", mappings: [mapping(), mapping("41")], roles: snapshots }), 400)
    await status(await f.manage({ type: "panel-create", name: "many", kind: "verification", mappings: [mapping(), mapping("41", "⭐")], roles: snapshots }), 400)
})
test("All staff-role classes reject configured roles even when modules and definitions are disabled", async test => {
    const f = fixture(test); const panel = await f.create(); await read(await f.manage({ type: "panel-update", name: panel.name, expectedRevision: 1, patch: { enabled: false } }))
    for (const scope of ["moderation", "security", "cases", "appeals", "automod"]) await status(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { [scope]: ["40"] } } })), 409)
    await read(await f.settings({ autoroleIds: ["41"] })); await status(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["41"] } } })), 409)
    const old = await f.withdrawal(panel, true); assert.equal(old.status, "complete")
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["40"] } } })))
})
test("Panel binding protects publishing edits and forget across disable and requires a new message for changed mappings", async test => {
    const f = fixture(test); const panel = await f.ready(), published = panel.published!
    await read(await f.manage({ type: "panel-update", name: panel.name, expectedRevision: 1, patch: { enabled: false } }))
    await status(await f.http("/publishing/manage", f.manageRequest({ type: "forget", postNo: published.postNo, expectedGeneration: 1 })), 409)
    await status(await f.http("/publishing/manage", f.manageRequest({ type: "edit", kind: "draft", name: "synthetic_1", expectedRevision: 2, postNo: published.postNo, expectedGeneration: 1, context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } })), 409)
    const updated = (await read(await f.manage({ type: "panel-update", name: panel.name, expectedRevision: 1, patch: { mappings: [mapping("41")], enabled: true }, roles: snapshots }))).panel
    assert.equal(updated.revision, 2); assert.equal(updated.published.revision, 1)
    await status(await f.manage({ type: "panel-bind", name: panel.name, expectedRevision: 2, postNo: published.postNo, expectedPostGeneration: 1 }), 409)
    const next = await f.publish(updated); assert.notEqual(next.published!.messageId, published.messageId)
    await status(await f.evaluate({ type: "reaction", name: panel.name, revision: 1, messageId: published.messageId, presentEmojis: ["✅"], panelVerified: true }), 409)
    const refs = await read(await f.query({ type: "configuration-list", name: panel.name })); assert.equal(refs.references.length, 2)
    await status(await f.http("/publishing/manage", f.manageRequest({ type: "forget", postNo: published.postNo, expectedGeneration: 1 })), 409)
})
test("Pre-existing roles are referenced without removal ownership and withdrawal never removes them", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const member = { ...context, roleIds: ["40", "79"] }
    assert.equal((await read(await f.choose(panel, "40", true, member))).grant, undefined)
    assert.equal((await f.claims(member))[0].owned, false)
    const removed = await read(await f.choose(panel, "40", false, member)); assert.equal(removed.grant, undefined)
    assert.equal((await f.claims(member)).length, 0)
    assert.equal((await f.withdrawal(panel, true)).status, "complete")
})
test("Confirmed add and exact observed removal retain the provider epoch and never affect unrelated roles", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const added = await grant(await f.choose(panel)); assert.equal(added.joinedAt, joinedAt)
    let member = await f.applied(added, { ...context, roleIds: ["79"] }); assert.deepEqual(member.roleIds, ["79", "40"])
    assert.equal((await f.claims(member))[0].owned, true)
    const removed = await grant(await f.choose(panel, "40", false, member)); assert.equal(removed.action, "remove")
    member = await f.applied(removed, member); assert.deepEqual(member.roleIds, ["79"])
    assert.equal((await read(await f.outcome(removed))).recorded, false)
    await status(await f.outcome(removed, "failed"), 409)
})
test("Per-consumer references prevent removal until the last consumer withdraws", async test => {
    const f = fixture(test), first = await f.ready("first"), second = await f.ready("second"); await read(await f.settings({ panelsEnabled: true }))
    const added = await grant(await f.choose(first)), member = await f.applied(added)
    await read(await f.choose(second, "40", true, member))
    assert.equal((await read(await f.choose(first, "40", false, member))).grant, undefined)
    const claims = await f.claims(member); assert.deepEqual(claims[0].consumerKeys, [`panel:second:${second.revision}`])
    assert.equal((await grant(await f.choose(second, "40", false, member))).action, "remove")
})
test("Rules acknowledgment is distinct from uncertain access and gates all self-service and autorole grants", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping("41")], "verification"), colors = await f.ready()
    await read(await f.settings({ panelsEnabled: true, verificationEnabled: true, autoroleEnabled: true, autoroleIds: ["42"] }))
    await status(await f.choose(colors), 403); await status(await f.evaluate({ type: "join" }), 403)
    const verification = await read(await f.evaluate({ type: "verify", name: rules.name, revision: 1 })); assert.equal(verification.acknowledgment.acknowledged, true); assert.equal(verification.acknowledgment.accessConfirmed, false)
    await read(await f.dispatch(verification.grant)); await read(await f.outcome(verification.grant, "uncertain"))
    const statusResult = await read(await f.memberQuery({ ...context, roleIds: ["41"] })); assert.equal(statusResult.acknowledgment.accessConfirmed, false); assert.equal(statusResult.acknowledgment.accessRolePresent, true)
    const custom = await grant(await f.choose(colors)); assert.equal(custom.roleId, "40")
    const auto = await grant(await f.evaluate({ type: "join" })); assert.equal(auto.roleId, "42")
})
test("A verification after the join unlocks autoroles through its own later source", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping("41")], "verification")
    await read(await f.settings({ verificationEnabled: true, autoroleEnabled: true, autoroleIds: ["42"] }))
    await status(await f.evaluate({ type: "join" }), 403)
    f.advance(600000); await read(await f.evaluate({ type: "verify", name: rules.name, revision: 1 }))
    const auto = await grant(await f.evaluate({ type: "join" }, context, { createdAt: f.now() })); assert.equal(auto.roleId, "42")
})
test("Chat role list edits reject a stale settings revision instead of overwriting it", async test => {
    const f = fixture(test), saved = await read(await f.settings({ autoroleIds: ["40"] }))
    await status(await f.manage({ type: "settings", patch: { autoroleIds: ["41"] }, roles: snapshots, expectedRevision: saved.settings.revision - 1 }), 409)
    const current = await read(await f.manage({ type: "settings", patch: { autoroleIds: ["41"] }, roles: snapshots, expectedRevision: saved.settings.revision }))
    assert.deepEqual(current.settings.autoroleIds, ["41"])
})
test("Current verification reaction can acknowledge a rejoined epoch, while old publication and quarantine fail closed", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping("41")], "verification"); await read(await f.settings({ verificationEnabled: true }))
    const member = { ...context, joinedAt: "2023-11-14T21:00:00+00:00", roleIds: ["41"] }
    const result = await read(await f.evaluate({ type: "verify", name: rules.name, revision: 1, messageId: rules.published!.messageId, reactionPresent: true, panelVerified: true }, member))
    assert.equal(result.acknowledgment.acknowledged, true); assert.equal(result.acknowledgment.accessConfirmed, true)
    await status(await f.evaluate({ type: "verify", name: rules.name, revision: 1, messageId: "123", reactionPresent: true, panelVerified: true }, member), 403)
    await status(await f.evaluate({ type: "verify", name: rules.name, revision: 1 }, { ...member, timeoutUntil: new Date(f.now() + 60000).toISOString() }), 403)
    const actionContext = { botId: "999", botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null }
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic quarantine" }, context: actionContext })))
    await status(await f.evaluate({ type: "verify", name: rules.name, revision: 1 }, member), 403)
})
test("Prerequisites, exclusions and fresh role safety are enforced centrally", async test => {
    const f = fixture(test), panel = await f.ready("colors", [{ ...mapping(), prerequisiteRoleIds: ["70"], exclusionRoleIds: ["71"] }]); await read(await f.settings({ panelsEnabled: true }))
    await status(await f.choose(panel), 403); await status(await f.choose(panel, "40", true, { ...context, roleIds: ["70", "71"] }), 403)
    const value = await grant(await f.choose(panel, "40", true, { ...context, roleIds: ["70"] }))
    await status(await f.dispatch(value, { ...context, roleIds: ["70"], roles: snapshots.map(x => x.roleId === "40" ? { ...x, permissions: "8" } : x) }), 403)
    await status(await f.dispatch(value, { ...context, roleIds: ["70"], joinedAt: "2023-11-14T21:00:00Z" }), 409)
    await status(await f.dispatch(value, { ...context, roleIds: ["70", "40"] }), 409)
})
test("Exclusive ambiguity preserves the previous choice and switching releases before granting with exact continuation", async test => {
    const f = fixture(test), panel = await f.ready("exclusive", [mapping(), mapping("41", "⭐")], "reaction", true); await read(await f.settings({ panelsEnabled: true }))
    const initial = await grant(await f.choose(panel)), member = await f.applied(initial)
    const reaction = { type: "reaction" as const, name: panel.name, revision: 1, messageId: panel.published!.messageId, presentEmojis: ["✅", "⭐"], panelVerified: true }
    assert.equal((await read(await f.evaluate(reaction, member))).status, "ambiguous"); assert.equal((await f.claims(member))[0].owned, true)
    const request = f.evaluation({ type: "choose", name: panel.name, revision: 1, roleId: "41", selected: true }, member)
    const removal = await grant(await f.http("/roles/evaluate", request)); assert.equal(removal.action, "remove")
    const after = await f.applied(removal, member)
    await status(await f.http("/roles/evaluate", { ...request, context: after, operation: { ...request.operation, roleId: "40" }, continuationAttemptId: removal.attemptId }), 409)
    const addition = await grant(await f.http("/roles/evaluate", { ...request, context: after, continuationAttemptId: removal.attemptId })); assert.equal(addition.roleId, "41")
    assert.equal((await read(await f.http("/roles/evaluate", { ...request, context: after, continuationAttemptId: removal.attemptId }))).duplicate, true)
})
test("Exclusive switches reject pre-existing and other-consumer conflicts without altering references", async test => {
    const f = fixture(test), panel = await f.ready("exclusive", [mapping(), mapping("41", "⭐")], "reaction", true), other = await f.ready("other"); await read(await f.settings({ panelsEnabled: true }))
    await status(await f.choose(panel, "41", true, { ...context, roleIds: ["40"] }), 409)
    const original = await grant(await f.choose(panel)), member = await f.applied(original); await read(await f.choose(other, "40", true, member))
    await status(await f.choose(panel, "41", true, member), 409)
    assert.deepEqual((await f.claims(member))[0].consumerKeys.sort(), [`panel:exclusive:${panel.revision}`, `panel:other:${other.revision}`])
})
test("One immutable source and one capability prevent lost-result replay and a denied claimant from finalizing another operation", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const request = f.evaluation({ type: "choose", name: panel.name, revision: 1, roleId: "40", selected: true }), value = await grant(await f.http("/roles/evaluate", request))
    assert.equal((await read(await f.http("/roles/evaluate", request))).duplicate, true)
    assert.equal((await read(await f.dispatch(value))).claimed, true); assert.equal((await read(await f.dispatch(value, context, { claimToken: "a".repeat(32) }))).claimed, false)
    await status(await f.outcome(value, "failed", { claimToken: "a".repeat(32) }), 409)
    await status(await f.http("/roles/outcome", { ...f.binding(value), outcome: "failed" }), 409)
    await read(await f.outcome(value)); assert.equal((await f.claims({ ...context, roleIds: ["40"] }))[0].owned, true)
    await status(await f.http("/roles/evaluate", { ...request, sourceId: "new", createdAt: f.now() - 900001 }), 400)
})
test("Dispatch rechecks module, current publication and verification acknowledgment after reservation", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)); await read(await f.settings({ panelsEnabled: false })); await status(await f.dispatch(value), 403)
    await read(await f.settings({ panelsEnabled: true })); await read(await f.manage({ type: "panel-update", name: panel.name, expectedRevision: 1, patch: { mappings: [mapping("41")] }, roles: snapshots })); await f.publish((await read(await f.query({ type: "panel-show", name: panel.name }))).panel)
    await status(await f.dispatch(value), 403)
})
test("Reconcile unlocks an uncertain addition after its window and never turns a present role into ownership", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)); await read(await f.dispatch(value)); await read(await f.outcome(value, "uncertain"))
    const reconcile = (present: boolean, observedAt = f.now(), epoch = joinedAt) => f.http("/roles/reconcile", { ...f.source(), actor: owner, attemptId: value.attemptId, generation: value.generation, observation: { observedAt, userId: "20", joinedAt: epoch, roleId: "40", present } })
    await status(await reconcile(true), 409)
    f.advance(190001)
    const unlocked = await read(await reconcile(true))
    assert.equal(unlocked.recorded, true); assert.equal(unlocked.claim.status, "idle"); assert.equal(unlocked.claim.owned, false)
    const attempted = await read(await f.query({ type: "attempt-show", attemptId: value.attemptId })); assert.equal(attempted.attempt.outcome, "uncertain")
})
test("Explicit withdrawals stay available with grants disabled, use bounded steps and preserve shared-role consumers", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)), member = await f.applied(value)
    await read(await f.settings({ panelsEnabled: false }))
    const job = await f.withdrawal(panel, true); assert.equal(job.remainingAtLeast, 1); assert.equal(job.hasMore, false)
    const removal = await grant(await f.evaluate({ type: "withdraw", withdrawalId: job.withdrawalId, roleId: "40" }, member, { actor: owner })); await f.applied(removal, member)
    const next = f.manageRequest({ type: "withdraw-next", withdrawalId: job.withdrawalId, expectedStep: job.step })
    assert.equal((await read(await f.http("/roles/manage", next))).withdrawal.status, "complete")
    assert.equal((await read(await f.http("/roles/manage", next))).duplicate, true)
    await status(await f.query({ type: "panel-show", name: panel.name }), 404)
})
test("Settled departed withdrawal retires only the old epoch without native grants or touching a rejoined membership", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)); await f.applied(value)
    const job = await f.withdrawal(panel, true), different = "2023-11-14T21:00:00Z"
    const result = await read(await f.manage({ type: "withdraw-departed", withdrawalId: job.withdrawalId, userId: "20", joinedAt, currentJoinedAt: different, observedAt: f.now() }))
    assert.equal(result.withdrawal.status, "complete"); assert.equal((await f.claims()).length, 0)
    assert.equal((await f.t.run(c => c.db.query("roleAttempts").collect())).length, 1)
})
test("Departed or rejoined unknown ownership remains retained after aging and blocks staff-role assignment", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)); await read(await f.dispatch(value)); f.advance(190001); await read(await f.http("/roles/observe", { serverId: "1", mode: "restart" }))
    const job = await f.withdrawal(panel, true)
    for (const currentJoinedAt of [null, "2023-11-14T21:00:00Z"]) await status(await f.manage({ type: "withdraw-departed", withdrawalId: job.withdrawalId, userId: "20", joinedAt, currentJoinedAt, observedAt: f.now() }), 409)
    assert.equal((await f.claims())[0].status, "uncertain")
    await status(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { staffRoleIds: { security: ["40"] } } })), 409)
})
test("A later membership epoch releases settled earlier acknowledgments and ownership but keeps unresolved ownership", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping("41")], "verification"), colors = await f.ready("colors", [mapping("40"), mapping("42", "🟦")])
    await read(await f.settings({ panelsEnabled: true, verificationEnabled: true }))
    let member = await f.applied(await grant(await f.evaluate({ type: "verify", name: rules.name, revision: 1 })))
    member = await f.applied(await grant(await f.choose(colors, "40", true, member)), member)
    const unknown = await grant(await f.choose(colors, "42", true, member)); await read(await f.dispatch(unknown, member)); await read(await f.outcome(unknown, "uncertain"))
    const rejoined = { ...context, joinedAt: "2023-11-14T22:13:20.000000Z" }
    await f.applied(await grant(await f.evaluate({ type: "verify", name: rules.name, revision: 1 }, rejoined)), rejoined)
    const rows = await f.t.run(async c => ({ owners: await c.db.query("roleOwnership").collect(), acknowledgments: await c.db.query("roleAcknowledgments").collect(), references: await c.db.query("roleReferences").collect(), attempts: await c.db.query("roleAttempts").collect() }))
    assert.deepEqual(rows.acknowledgments.map(row => row.joinedAt), [rejoined.joinedAt])
    assert.deepEqual(rows.owners.map(row => [row.joinedAt, row.roleId, row.status]).sort(), [[joinedAt, "42", "uncertain"], [rejoined.joinedAt, "41", "idle"]])
    const owners = rows.owners.map(row => row._id)
    assert(rows.references.every(ref => ref.ownershipId === undefined || owners.includes(ref.ownershipId)))
    assert.equal(rows.attempts.length, 4)
})
test("Autorole defaults humans-only, explicit bot opt-in never bypasses configured verification or scans members", async test => {
    const f = fixture(test); await read(await f.settings({ autoroleIds: ["40"], autoroleEnabled: true }))
    assert.equal((await f.t.run(c => c.db.query("roleAttempts").collect())).length, 0)
    const bot = { ...context, userId: "21", isBot: true }
    assert.equal((await read(await f.evaluate({ type: "join" }, bot))).grant, undefined)
    await read(await f.settings({ humansOnly: false })); assert.equal((await grant(await f.evaluate({ type: "join" }, bot))).roleId, "40")
    await f.ready("rules", [mapping("41")], "verification")
    await status(await f.evaluate({ type: "join" }, { ...bot, userId: "22" }), 403)
})
test("Unclaimed expiry proves non-dispatch, claimed aging preserves uncertainty, and bounded retention releases only terminal history", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const unclaimed = await grant(await f.choose(panel)), secondMember = { ...context, userId: "21" }, claimed = await grant(await f.choose(panel, "40", true, secondMember))
    await read(await f.dispatch(claimed, secondMember)); f.advance(190001); await read(await f.http("/roles/observe", { serverId: "1", mode: "aged" }))
    const first = await read(await f.query({ type: "attempt-show", attemptId: unclaimed.attemptId })), second = await read(await f.query({ type: "attempt-show", attemptId: claimed.attemptId }))
    assert.equal(first.attempt.outcome, "failed"); assert.equal(first.attempt.noDispatch, true); assert.equal(second.attempt.outcome, "uncertain")
    assert.equal((await read(await f.dispatch(unclaimed))).claimed, false)
    f.advance(181 * ROLES_DAY); await f.t.mutation(internal.roleLifecycle.cleanup, {})
    await status(await f.query({ type: "attempt-show", attemptId: unclaimed.attemptId }), 404); assert.equal((await read(await f.query({ type: "attempt-show", attemptId: claimed.attemptId }))).attempt.outcome, "uncertain")
    assert.equal((await f.t.run(c => c.db.query("roleReceipts").collect())).length, 0)
})
test("An undispatched source is never evaluated again for a later membership epoch", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const operation: RolesEvaluateOperation = { type: "choose", name: panel.name, revision: panel.published!.revision, roleId: "40", selected: true }
    await grant(await f.evaluate(operation, context, { sourceId: "epoch-source" })); f.advance(190001); await read(await f.http("/roles/observe", { serverId: "1", mode: "aged" }))
    const rejoined = { ...context, joinedAt: new Date(f.now() - 1000).toISOString() }
    const replay = await read(await f.evaluate(operation, rejoined, { sourceId: "epoch-source" }))
    assert.equal(replay.duplicate, true); assert.equal(replay.grant, undefined)
})
test("Verification command must be post-join while the exact current panel reaction remains reusable", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping("41")], "verification"); await read(await f.settings({ verificationEnabled: true }))
    const member = { ...context, joinedAt: new Date(f.now() - 1000).toISOString(), roleIds: ["41"] }
    const request = f.evaluation({ type: "verify", name: "rules", revision: 1 }, member); request.createdAt = f.now() - 2000
    await status(await f.http("/roles/evaluate", request), 400)
    const reaction = await read(await f.evaluate({ type: "verify", name: "rules", revision: 1, messageId: rules.published!.messageId, panelVerified: true, reactionPresent: true }, member))
    assert.equal(reaction.acknowledgment.acknowledged, true); assert.equal(reaction.acknowledgment.accessConfirmed, true)
})
test("A confirmed removal with a lost acknowledgment retires its inaccessible zero-reference owner only at normal history expiry", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const initial = await grant(await f.choose(panel)), member = await f.applied(initial), removal = await grant(await f.choose(panel, "40", false, member))
    await read(await f.dispatch(removal, member)); await read(await f.outcome(removal))
    assert.equal((await f.claims())[0].owned, false)
    f.advance(179 * ROLES_DAY); await f.t.mutation(internal.roleLifecycle.cleanup, {})
    assert.equal((await f.t.run(c => c.db.query("roleOwnership").collect())).length, 1)
    assert.equal((await f.t.run(c => c.db.query("roleAttempts").collect())).length, 2)
    f.advance(2 * ROLES_DAY); await f.t.mutation(internal.roleLifecycle.cleanup, {})
    assert.equal((await f.t.run(c => c.db.query("roleOwnership").collect())).length, 0)
    assert.equal((await f.t.run(c => c.db.query("roleAttempts").collect())).length, 0)
})
test("Own claim metadata is scoped to the requester and DEFCON blocks participation while admin recovery remains usable", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const value = await grant(await f.choose(panel)), member = await f.applied(value), ordinary = { ...owner, userId: "20", isOwner: false, nativePermissionAuthorized: false }
    await read(await f.query({ type: "claim-list", userId: "20", joinedAt }, ordinary)); await status(await f.query({ type: "claim-list", userId: "21", joinedAt }, ordinary), 403)
    await read(await f.http("/moderation/manage", f.manageRequest({ type: "settings", patch: { defcon: 1 } })))
    await status(await f.query({ type: "claim-list", userId: "20", joinedAt }, ordinary), 403)
    await status(await f.evaluate({ type: "withdraw-member", consumerKey: "panel:colors:1", roleId: "40" }, member), 400)
    const removal = await grant(await f.evaluate({ type: "withdraw-member", consumerKey: "panel:colors:1", roleId: "40" }, member, { actor: owner })); assert.equal(removal.action, "remove")
    await status(await f.dispatch(removal, member, { actor: undefined }), 400); await read(await f.dispatch(removal, member, { actor: owner }))
})

test("The combined panel boundary permits 50 reaction panels and exactly one verification panel", async test => {
    const f = fixture(test)
    for (let index = 0; index < 50; index++) await f.create(`panel_${index}`, [])
    await f.create("rules", [], "verification")
    await status(await f.manage({ type: "panel-create", name: "overflow", kind: "reaction" }), 429)
    await status(await f.manage({ type: "panel-create", name: "rules_two", kind: "verification" }), 429)
    assert.equal((await read(await f.memberQuery())).panels.length, 51)
    assert.equal((await read(await f.query({ type: "panel-list", page: 6 }))).panels.length, 1)
})
test("Withdrawal batches expose lower bounds, exact step guards and scoped same-message departed observations", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    for (let index = 0; index < 12; index++) { const member = { ...context, userId: String(100 + index) }; await f.applied(await grant(await f.choose(panel, "40", true, member)), member) }
    const job = await f.withdrawal(panel, true); assert.equal(job.remainingAtLeast, 11); assert.equal(job.hasMore, true); assert.equal(job.targets.length, 10)
    const sharedSource = f.source()
    for (const target of job.targets) {
        const request = { ...sharedSource, actor: owner, operation: { type: "withdraw-departed", withdrawalId: job.withdrawalId, ...target, currentJoinedAt: null, observedAt: f.now() } }
        delete (request.operation as { roleId?: string }).roleId
        await read(await f.http("/roles/manage", request)); assert.equal((await read(await f.http("/roles/manage", request))).duplicate, true)
    }
    const current = (await read(await f.query({ type: "withdrawal-show", withdrawalId: job.withdrawalId }))).withdrawal
    assert.equal(current.remainingAtLeast, 2)
    await status(await f.manage({ type: "withdraw-next", withdrawalId: job.withdrawalId, expectedStep: job.step }), 409)
    for (const target of current.targets) await read(await f.manage({ type: "withdraw-departed", withdrawalId: job.withdrawalId, userId: target.userId, joinedAt: target.joinedAt, currentJoinedAt: "2023-11-14T21:00:00Z", observedAt: f.now() }))
    assert.equal((await read(await f.query({ type: "withdrawal-show", withdrawalId: job.withdrawalId }))).withdrawal.status, "complete")
})
test("Verification withdrawal clears exact historical acknowledgments without removing unrelated epoch evidence", async test => {
    const f = fixture(test), rules = await f.ready("rules", [mapping()], "verification"); await read(await f.settings({ verificationEnabled: true }))
    const value = await grant(await f.evaluate({ type: "verify", name: "rules", revision: 1 })); await f.applied(value)
    const job = await f.withdrawal(rules, true)
    await read(await f.manage({ type: "withdraw-departed", withdrawalId: job.withdrawalId, userId: "20", joinedAt, currentJoinedAt: null, observedAt: f.now() }))
    assert.equal((await f.t.run(c => c.db.query("roleAcknowledgments").collect())).length, 0)
})
test("Configuration and claim lists navigate bounded pages without scanning a member roster", async test => {
    const f = fixture(test), maps = snapshots.slice(0, 12).map((role, index) => mapping(role.roleId, `choice_${index}`)), panel = await f.ready("many", maps)
    await read(await f.settings({ panelsEnabled: true }))
    let member = { ...context, roleIds: maps.map(x => x.roleId) }
    for (const map of maps) await read(await f.choose(panel, map.roleId, true, member))
    const first = await read(await f.query({ type: "claim-list", userId: member.userId, joinedAt })); assert.equal(first.claims.length, 10); assert.equal(typeof first.nextCursor, "string")
    const second = await read(await f.query({ type: "claim-list", userId: member.userId, joinedAt, cursor: first.nextCursor })); assert.equal(second.claims.length, 2); assert.equal(second.nextCursor, undefined)
    const configuration = await read(await f.query({ type: "configuration-list", name: panel.name })); assert.equal(configuration.references.length, 10)
    assert.equal((await read(await f.query({ type: "configuration-list", name: panel.name, cursor: configuration.nextCursor }))).references.length, 2)
})

test("Disabled participation preserves refs and roles, and explicit recovery always requires a fresh administrator actor", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const initial = await grant(await f.choose(panel)), member = await f.applied(initial)
    const before = await f.claims(member)
    await read(await f.settings({ panelsEnabled: false }))
    await status(await f.choose(panel, "40", false, member), 403)
    await status(await f.evaluate({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, member), 403)
    assert.deepEqual(await f.claims(member), before)
    const op = { type: "withdraw-member" as const, consumerKey: `panel:${panel.name}:${panel.revision}`, roleId: "40" }
    await status(await f.evaluate(op, member), 400)
    await status(await f.evaluate(op, member, { actor: { ...owner, isOwner: false } }), 403)
    const removal = await grant(await f.evaluate(op, member, { actor: owner })); assert.equal(removal.action, "remove")
})
test("Recreated panel names never reuse revision or consumer identity and old completed jobs cannot withdraw new definitions", async test => {
    const f = fixture(test), first = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const old = await f.withdrawal(first, true); assert.equal(old.status, "complete")
    const recreated = await f.ready(); assert(recreated.revision > first.revision)
    await read(await f.manage({ type: "withdraw-next", withdrawalId: old.withdrawalId, expectedStep: old.step }))
    assert.equal((await read(await f.query({ type: "panel-show", name: first.name }))).panel.revision, recreated.revision)
    await status(await f.evaluate({ type: "reaction", name: first.name, revision: first.revision, messageId: first.published!.messageId, presentEmojis: ["✅"], panelVerified: true }), 409)
    await status(await f.evaluate({ type: "choose", name: first.name, revision: first.revision, roleId: "40", selected: true }), 409)
    const refs = await read(await f.query({ type: "configuration-list", name: first.name })); assert.deepEqual(refs.references.map((x: { consumerKey: string }) => x.consumerKey), [`panel:${first.name}:${recreated.revision}`])
})
test("Join reservations bind the current membership epoch and a replayed source grants nothing", async test => {
    const f = fixture(test); await read(await f.settings({ autoroleIds: ["40"], autoroleEnabled: true }))
    const request = f.evaluation({ type: "join" })
    const value = await grant(await f.rawHttp("/roles/evaluate", request)); assert.equal(value.joinedAt, joinedAt)
    const replay = await read(await f.rawHttp("/roles/evaluate", { ...request, context: { ...context, joinedAt: new Date(f.now()).toISOString() } }))
    assert.equal(replay.duplicate, true); assert.equal(replay.grant, undefined)
    f.advance(900001); await status(await f.evaluate({ type: "join" }, { ...context, userId: "21" }), 400)
})

test("Ordinary removal is fenced by a later disable while exact staff withdrawal stays usable", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const member = await f.applied(await grant(await f.choose(panel)))
    const removal = await grant(await f.choose(panel, "40", false, member)); await read(await f.settings({ panelsEnabled: false }))
    await status(await f.dispatch(removal, member), 403)
    await read(await f.http("/roles/outcome", { ...f.binding(removal), outcome: "failed" }))
    const recovery = await grant(await f.evaluate({ type: "withdraw-member", consumerKey: `panel:${panel.name}:${panel.revision}`, roleId: "40" }, member, { actor: owner }))
    assert.equal((await read(await f.dispatch(recovery, member))).claimed, true)
})

test("A newer desired-state refresh prevents an older confirmed exclusive continuation from changing references", async test => {
    const f = fixture(test), panel = await f.ready("colors", [mapping(), mapping("41", "⭐")], "reaction", true); await read(await f.settings({ panelsEnabled: true }))
    const member = await f.applied(await grant(await f.choose(panel)))
    const request = f.evaluation({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: ["⭐"], panelVerified: true }, member)
    const remove = await grant(await f.http("/roles/evaluate", request)), after = await f.applied(remove, member)
    const newer = await grant(await f.evaluate({ ...request.operation, presentEmojis: ["✅"] } as RolesEvaluateOperation, after)); assert.equal(newer.roleId, "40")
    const before = await f.t.run(c => c.db.query("roleReferences").collect())
    await status(await f.http("/roles/evaluate", { ...request, context: after, continuationAttemptId: remove.attemptId }), 409)
    assert.deepEqual(await f.t.run(c => c.db.query("roleReferences").collect()), before)
})

test("Durable reaction pages survive deletion under cursor and coalesce a rerun arriving during the last page", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    for (let index = 0; index < 12; index++) await read(await f.choose(panel, "40", true, { ...context, userId: String(100 + index), roleIds: ["40"] }))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }), enqueued = await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))
    let job = enqueued.job, count = 0
    for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
        const claimToken = String(pageIndex + 1).padStart(32, "0"), page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken })); assert.equal(page.claimed, true)
        for (const [index, target] of page.targets.entries()) {
            const result = await read(await f.evaluate({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, { ...context, userId: target.userId, roleIds: ["40"] }, { sourceId: target.sourceId, reactionJob: { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index } }))
            assert.equal(result.grant, undefined); count++
        }
        if (pageIndex === 1) await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))
        job = (await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked: false }))).job
    }
    assert.equal(count, 12); assert.equal(job.status, "queued")
    const last = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken: "a".repeat(32) })); assert.deepEqual(last.targets, [])
    job = (await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: last.job.generation, pageStep: last.job.pageStep, claimToken: "a".repeat(32), blocked: false }))).job
    assert.equal(job.status, "complete"); assert.deepEqual((await read(await jobs({ type: "list" }))).jobs, [])
})

test("Unknown targets remain visible while later reaction pages complete, and no pending operation is replayed", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const unknown = await grant(await f.choose(panel)); await read(await f.dispatch(unknown)); await read(await f.outcome(unknown, "uncertain"))
    for (let index = 0; index < 11; index++) await read(await f.choose(panel, "40", true, { ...context, userId: String(100 + index), roleIds: ["40"] }))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }); let job = (await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))).job, visited = 0
    for (let step = 1; step <= 2; step++) {
        const claimToken = String(step).padStart(32, "0"), page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken })); let blocked = false
        for (const [index, target] of page.targets.entries()) {
            const result = await read(await f.evaluate({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, { ...context, userId: target.userId, roleIds: target.userId === "20" ? [] : ["40"] }, { sourceId: target.sourceId, reactionJob: { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index } }))
            assert.equal(result.grant, undefined); blocked ||= result.status === "blocked"; visited++
        }
        job = (await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked }))).job
    }
    assert.equal(visited, 12); assert.equal(job.status, "blocked"); assert.equal((await read(await jobs({ type: "list" }))).jobs[0].status, "blocked")
    const claims = await f.claims(); assert.equal(claims[0].status, "uncertain"); assert.equal(claims[0].attempt.attemptId, unknown.attemptId)
})

test("Lost reaction leases cannot checkpoint, evaluate or dispatch, and changed or disabled panels cancel exact jobs", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const member = await f.applied(await grant(await f.choose(panel)))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }), job = (await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))).job, claimToken = "a".repeat(32)
    const page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken })), reactionJob = { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index: 0 }
    const request = f.evaluation({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, member, { sourceId: page.targets[0].sourceId, reactionJob })
    const removal = await grant(await f.http("/roles/evaluate", request))
    await status(await jobs({ type: "checkpoint", ...reactionJob, claimToken: "b".repeat(32), blocked: false, index: undefined }), 409)
    f.advance(600000); await status(await f.http("/roles/evaluate", { ...request, createdAt: f.now() }), 409)
    assert.equal((await read(await f.dispatch(removal, member))).claimed, false)
    const next = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken: "b".repeat(32) })); assert(next.job.generation > page.job.generation)
    await status(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked: true }), 409)
    await read(await f.settings({ panelsEnabled: false })); assert.deepEqual((await read(await jobs({ type: "list" }))).jobs, [])
    assert.equal((await f.t.run(c => c.db.query("roleReactionJobs").first()))!.status, "cancelled")
})

test("Verification reaction removal preserves reusable acknowledgment and completes its bound durable page", async test => {
    const f = fixture(test), panel = await f.ready("rules", [mapping()], "verification"); await read(await f.settings({ verificationEnabled: true }))
    const member = { ...context, roleIds: ["40"] }; await read(await f.evaluate({ type: "verify", name: panel.name, revision: panel.revision }, member))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }), job = (await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))).job, claimToken = "a".repeat(32)
    const page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken }))
    const result = await read(await f.evaluate({ type: "verify", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, panelVerified: true, reactionPresent: false }, member, { sourceId: page.targets[0].sourceId, reactionJob: { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index: 0 } }))
    assert.equal(result.status, "unchanged"); assert.equal(result.acknowledgment.acknowledged, true); assert.equal(result.acknowledgment.accessConfirmed, true)
    assert.equal((await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked: false }))).job.status, "complete")
})

test("A failed or unknown page action can be marked blocked without replay and late outcome acknowledgment is independent from the page lease", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const member = await f.applied(await grant(await f.choose(panel)))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }), job = (await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))).job, claimToken = "a".repeat(32)
    const page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken })), binding = { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index: 0 }
    const removal = await grant(await f.evaluate({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, member, { sourceId: page.targets[0].sourceId, reactionJob: binding }))
    await read(await f.dispatch(removal, member))
    await status(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked: true }), 409)
    f.advance(600000); assert.equal((await read(await f.outcome(removal, "uncertain"))).recorded, true)
    await status(await jobs({ type: "block", binding }), 409)
    const resumed = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken: "b".repeat(32) })), fresh = { jobId: job.jobId, generation: resumed.job.generation, pageStep: resumed.job.pageStep, claimToken: "b".repeat(32), index: 0 }
    await read(await jobs({ type: "block", binding: fresh }))
    assert.equal((await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: fresh.generation, pageStep: fresh.pageStep, claimToken: fresh.claimToken, blocked: true }))).job.status, "blocked")
    assert.equal((await f.claims(member))[0].attempt.attemptId, removal.attemptId)
    assert.equal((await f.claims(member))[0].status, "uncertain")
})

test("Skipping a departed known consumer never deletes old unknown provenance or permits a same-epoch skip", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const initial = await grant(await f.choose(panel)); await read(await f.dispatch(initial)); await read(await f.outcome(initial, "uncertain"))
    const jobs = (operation: unknown) => f.http("/roles/reaction-jobs", { serverId: "1", operation }), job = (await read(await jobs({ type: "enqueue", messageId: panel.published!.messageId }))).job, claimToken = "a".repeat(32)
    const page = await read(await jobs({ type: "claim", jobId: job.jobId, claimToken })), binding = { jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, index: 0 }
    await status(await jobs({ type: "skip", binding, currentJoinedAt: joinedAt }), 409)
    await read(await jobs({ type: "skip", binding, currentJoinedAt: null }))
    assert.equal((await read(await jobs({ type: "checkpoint", jobId: job.jobId, generation: page.job.generation, pageStep: page.job.pageStep, claimToken, blocked: false }))).job.status, "blocked")
    assert.equal((await f.claims())[0].status, "uncertain"); assert.equal((await f.claims())[0].attempt.attemptId, initial.attemptId)
})

test("Native timeout and backend quarantine block public deselection and its dispatch while explicit staff recovery preserves access", async test => {
    const f = fixture(test), panel = await f.ready(); await read(await f.settings({ panelsEnabled: true }))
    const member = await f.applied(await grant(await f.choose(panel))), timed = { ...member, timeoutUntil: new Date(f.now() + 60000).toISOString() }
    const before = await f.claims(member); await status(await f.choose(panel, "40", false, timed), 403); assert.deepEqual(await f.claims(member), before)
    const removal = await grant(await f.choose(panel, "40", false, member)); await status(await f.dispatch(removal, timed), 403)
    await read(await f.http("/roles/outcome", { ...f.binding(removal), outcome: "failed" }))
    const quarantine = await read(await f.http("/moderation/manage", f.manageRequest({ type: "action", action: { type: "quarantine", targetId: member.userId, durationSeconds: 60, reason: "Synthetic fixture" }, context: { botId: "999", botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null } })))
    assert.equal(quarantine.case.outcome, "pending")
    await status(await f.evaluate({ type: "reaction", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId, presentEmojis: [], panelVerified: true }, member), 403)
    const recovery = await grant(await f.evaluate({ type: "withdraw-member", consumerKey: `panel:${panel.name}:${panel.revision}`, roleId: "40" }, timed, { actor: owner }))
    assert.equal((await read(await f.dispatch(recovery, timed))).claimed, true)
})
