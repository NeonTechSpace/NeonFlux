import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { RolesEvaluateResult, RolesGrant } from "@neonflux/contracts/roles"
import type { ModerationActor, RolesMemberContext } from "@neonflux/contracts/shared"
import type { TemporaryRoleGrant } from "@neonflux/contracts/temporary-roles"
import { botCall } from "./bot-service.ts"

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const secret = "synthetic-temporary-roles-secret-not-a-credential"
const scopeKeys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const prior = Object.fromEntries(scopeKeys.map(key => [key, process.env[key]]))
const MINUTE = 60000, DAY = 86400000, joinedAt = "2023-11-14T22:13:19.000Z", rejoinedAt = "2023-12-01T10:00:00.000Z"
let now = 0
beforeEach(() => {
    now = 1700000000000
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    process.env.NEONFLUX_SERVER_ID = "10"; process.env.FLUXER_CLIENT_ID = "30"; process.env.NEONFLUX_BOT_API_SECRET = secret
    delete process.env.NEONFLUX_SERVER_MODE; delete process.env.NEONFLUX_SERVER_IDS
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "21", username: "Synthetic manager", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of scopeKeys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})

// The staff member holds Manage Roles. Roles 40 to 43 are ordinary roles below NeonFlux and the staff member
const staff = (change: Partial<ModerationActor> = {}): ModerationActor => ({ originServerId: "10", userId: "21", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true, ...change })
const context = (roleIds: string[], change: Partial<RolesMemberContext> = {}): RolesMemberContext => ({ originServerId: "10", userId: "20", joinedAt, roleIds, isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true,
    roles: ["40", "41", "42", "43"].map(roleId => ({ originServerId: "10", roleId, permissions: "0", botCanManage: true, actorCanManage: true })), ...change })

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true })
    let sequence = 1000
    const raw = (path: string, body: Record<string, unknown>) => botCall(t, path, { serverId: "10", ...body })
    const ok = async (response: Response) => { assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const call = async (path: string, body: Record<string, unknown>) => ok(await raw(path, body))
    const manageRequest = (operation: unknown, member = context([]), actor = staff()) => raw("/temproles/manage", { messageId: String(++sequence), createdAt: now, actor, context: member, operation })
    const manage = async (operation: unknown, member = context([]), actor = staff()) => (await ok(await manageRequest(operation, member, actor))) as { type: "grant", grant: TemporaryRoleGrant }
    const evaluateRequest = (grant: TemporaryRoleGrant, member: RolesMemberContext) => raw("/roles/evaluate", { sourceId: grant.sourceId, createdAt: now, context: member, operation: { type: "temporary", roleId: grant.roleId } })
    const evaluate = async (grant: TemporaryRoleGrant, member: RolesMemberContext) => (await ok(await evaluateRequest(grant, member))) as RolesEvaluateResult
    // The bot's native role write: claim the attempt, then report what Fluxer answered
    const binding = (grant: RolesGrant) => ({ attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId })
    const dispatch = (grant: RolesGrant, member: RolesMemberContext) => raw("/roles/dispatch", { ...binding(grant), claimToken: "c".repeat(32), context: member })
    const perform = async (grant: RolesGrant, member: RolesMemberContext) => {
        assert.equal((await ok(await dispatch(grant, member))).claimed, true)
        await call("/roles/outcome", { ...binding(grant), claimToken: "c".repeat(32), outcome: "succeeded" })
    }
    const give = async (roleId = "40") => {
        const { grant } = await manage({ type: "add", userId: "20", roleId, durationSeconds: 7 * 86400 })
        const reserved = await evaluate(grant, context([]))
        assert.equal(reserved.grant?.action, "add")
        await perform(reserved.grant!, context([]))
        return grant
    }
    const work = (operation: Record<string, unknown>) => call("/temproles/work", { operation })
    const due = async () => (await work({ type: "list" })).grants as TemporaryRoleGrant[]
    const grants = async () => (await call("/temproles/query", { actor: staff(), operation: { type: "list" } })).grants as TemporaryRoleGrant[]
    const dueServers = async () => ((await (await botCall(t, "/service/work", { cursor: null, requestedAt: now })).json()) as { kinds: { temproles: string[] } }).kinds.temproles
    const owners = () => t.run(ctx => ctx.db.query("roleOwnership").collect())
    return { t, raw, call, manageRequest, manage, evaluateRequest, evaluate, dispatch, perform, give, work, due, grants, dueServers, owners }
}

test("A temporary role is added through the shared role ownership, and its end makes it due and removes it", async () => {
    const f = await fixture()
    const { grant } = await f.manage({ type: "add", userId: "20", roleId: "40", durationSeconds: 7 * 86400 })
    assert.equal(grant.endsAt, now + 7 * DAY)
    const reserved = await f.evaluate(grant, context([]))
    assert.deepEqual([reserved.status, reserved.grant?.action, reserved.grant?.consumerKey], ["reserved", "add", "temporary"])
    await f.perform(reserved.grant!, context([]))
    assert.equal((await f.evaluate(grant, context(["40"]))).status, "unchanged")
    assert.deepEqual([await f.due(), await f.dueServers()], [[], []])
    now += 7 * DAY
    // An outage only delays the removal, since the grant stays due until it is settled
    now += DAY
    assert.deepEqual(await f.dueServers(), ["10"])
    const [ended] = await f.due()
    assert.equal(ended?.sourceId, grant.sourceId)
    const removal = await f.evaluate(ended!, context(["40"]))
    assert.deepEqual([removal.status, removal.grant?.action], ["reserved", "remove"])
    await f.perform(removal.grant!, context(["40"]))
    assert.equal((await f.evaluate(ended!, context([]))).status, "unchanged")
    assert.deepEqual([await f.grants(), await f.dueServers()], [[], []])
    const attempts = await f.t.run(ctx => ctx.db.query("roleAttempts").collect())
    assert.deepEqual(attempts.map(row => [row.action, row.consumerKey, row.outcome]), [["add", "temporary", "succeeded"], ["remove", "temporary", "succeeded"]])
})

test("An ended grant never removes a role NeonFlux did not add or another feature still needs", async () => {
    const f = await fixture()
    // A role the member already holds cannot become temporary
    assert.equal((await f.manageRequest({ type: "add", userId: "20", roleId: "40", durationSeconds: 3600 }, context(["40"]))).status, 409)
    assert.deepEqual(await f.grants(), [])
    // Staff removed the role before the end, so the end only closes the grant
    const removedEarly = await f.give("40")
    // Autorole also wants role 41, so the temporary grant's end leaves it
    const shared = await f.give("41")
    const owner = (await f.owners()).find(row => row.roleId === "41")!
    await f.t.run(ctx => ctx.db.insert("roleReferences", { serverId: "10", consumerKey: "autorole:1", roleId: "41", configuration: false, desired: true, ownershipId: owner._id, createdAt: now }))
    now += 7 * DAY
    assert.equal((await f.evaluate(removedEarly, context(["41"]))).status, "unchanged")
    assert.equal((await f.evaluate(shared, context(["41"]))).status, "unchanged")
    assert.deepEqual(await f.grants(), [])
    const attempts = await f.t.run(ctx => ctx.db.query("roleAttempts").collect())
    assert.equal(attempts.filter(row => row.action === "remove").length, 0)
    const kept = (await f.owners()).find(row => row.roleId === "41")!
    assert.equal(kept.owned, true)
    assert.deepEqual((await f.t.run(ctx => ctx.db.query("roleReferences").collect())).map(row => row.consumerKey), ["autorole:1"])
})

test("Renewing or shortening a grant fences a removal reserved for its older version", async () => {
    const f = await fixture()
    const grant = await f.give()
    now += 7 * DAY
    const removal = await f.evaluate(grant, context(["40"]))
    assert.equal(removal.grant?.action, "remove")
    const renewed = (await f.manage({ type: "set", userId: "20", roleId: "40", durationSeconds: 3 * 86400 }, context(["40"]))).grant
    assert.notEqual(renewed.sourceId, grant.sourceId)
    assert.equal(renewed.endsAt, now + 3 * DAY)
    assert.equal((await f.dispatch(removal.grant!, context(["40"]))).status, 409)
    assert.equal((await f.evaluateRequest(grant, context(["40"]))).status, 409)
    // The old attempt never reached Fluxer, so it ages out as failed and the renewed grant keeps the role
    now += 10 * MINUTE
    await f.call("/roles/observe", { mode: "aged" })
    assert.equal((await f.evaluate(renewed, context(["40"]))).status, "unchanged")
    // Shortening counts from now, and removing early ends the grant at once
    const shortened = (await f.manage({ type: "set", userId: "20", roleId: "40", durationSeconds: 3600 }, context(["40"]))).grant
    assert.equal(shortened.endsAt, now + 3600000)
    const ended = (await f.manage({ type: "remove", userId: "20", roleId: "40" }, context(["40"]))).grant
    assert.equal(ended.endsAt, now)
    assert.equal((await f.evaluate(ended, context(["40"]))).grant?.action, "remove")
})

test("A member who leaves loses the grant, and a role deletion ends it without a role change", async () => {
    const f = await fixture()
    const grant = await f.give("40")
    now += 7 * DAY
    const member = { reason: "member", userId: "20", roleId: "40", sourceId: grant.sourceId, originServerId: "10", memberUserId: "20", observedAt: now }
    // The current membership needs a role evaluation instead, and absence needs explicit evidence
    assert.equal((await f.raw("/temproles/work", { operation: { type: "end", ...member, currentJoinedAt: joinedAt } })).status, 409)
    assert.equal((await f.raw("/temproles/work", { operation: { type: "end", ...member, currentJoinedAt: null } })).status, 400)
    assert.deepEqual(await f.work({ type: "end", ...member, currentJoinedAt: rejoinedAt }), { type: "recorded", recorded: true })
    assert.deepEqual([await f.grants(), await f.owners()], [[], []])
    // The rejoined member can get the role again for the new membership
    const again = (await f.manage({ type: "add", userId: "20", roleId: "40", durationSeconds: 3600 }, context([], { joinedAt: rejoinedAt }))).grant
    assert.equal(again.joinedAt, rejoinedAt)
    const deleted = await f.give("41")
    assert.deepEqual(await f.work({ type: "end", reason: "role", userId: "20", roleId: "41", sourceId: deleted.sourceId }), { type: "recorded", recorded: true })
    assert.deepEqual((await f.grants()).map(row => row.roleId), ["40"])
})

test("A grant NeonFlux cannot settle stays with its problem and is checked again later", async () => {
    const f = await fixture()
    const grant = await f.give()
    now += 7 * DAY
    // Without Manage Roles the removal is refused with the reason code the bot turns into its fix
    const refused = await f.evaluateRequest(grant, context(["40"], { botAuthorized: false }))
    assert.deepEqual([refused.status, (await refused.json()).code], [403, "BOT_PERMISSION"])
    assert.deepEqual(await f.work({ type: "problem", userId: "20", roleId: "40", sourceId: grant.sourceId, problem: "permission" }), { type: "recorded", recorded: true })
    assert.equal((await f.grants())[0]?.problem, "permission")
    assert.deepEqual([await f.due(), await f.dueServers()], [[], []])
    now += 10 * MINUTE
    assert.deepEqual(await f.dueServers(), ["10"])
    assert.equal((await f.evaluate(grant, context(["40"]))).grant?.action, "remove")
    // A grant that changed since the bot read it is left alone
    assert.deepEqual(await f.work({ type: "problem", userId: "20", roleId: "40", sourceId: "temp_stale_1", problem: "role" }), { type: "recorded", recorded: false })
})

test("Role defaults set durations and limits from chat and the dashboard", async () => {
    const f = await fixture()
    const role = async (operation: Record<string, unknown>, actor = staff()) => f.raw("/temproles/manage", { messageId: "500", createdAt: now, actor, operation: { type: "role", roleId: "40", ...operation } })
    assert.equal((await f.manageRequest({ type: "add", userId: "20", roleId: "40" })).status, 400)
    assert.equal((await role({ defaultSeconds: 7 * 86400 }, staff({ nativePermissionAuthorized: false }))).status, 403)
    assert.equal((await role({ defaultSeconds: 7 * 86400, maxSeconds: 86400 })).status, 400)
    const saved = await (await role({ defaultSeconds: 7 * 86400, maxSeconds: 30 * 86400 })).json()
    assert.deepEqual(saved, { type: "settings", revision: 1, settings: { roles: [{ roleId: "40", defaultSeconds: 7 * 86400, maxSeconds: 30 * 86400 }] } })
    const { grant } = await f.manage({ type: "add", userId: "20", roleId: "40" })
    assert.equal(grant.endsAt, now + 7 * DAY)
    assert.equal((await f.manageRequest({ type: "set", userId: "20", roleId: "40", durationSeconds: 31 * 86400 })).status, 400)
    // A staff member must rank above the role
    const higher = context([], { roles: context([]).roles.map(row => ({ ...row, actorCanManage: false })) })
    assert.equal((await f.manageRequest({ type: "add", userId: "20", roleId: "41", durationSeconds: 3600 }, higher)).status, 403)
    // The dashboard sets both durations through the shared configuration revision
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-temporary-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const queued = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "temproles", operation: { type: "role", roleId: "41", defaultSeconds: 3600, maxSeconds: null },
        expectedConfigRevision: 1, requestId: "00000000-0000-4000-8000-000000000001" })
    assert(queued.jobId)
    const executed = await f.call("/dashboard-configuration/execute", { originServerId: "10", jobId: queued.jobId, actorId: "21", managerAuthorized: true, observedAt: now,
        actor: staff(), references: [{ id: "41", type: "role", serverId: "10", exists: true }] })
    assert.equal(executed.job.state, "applied")
    const snapshot = await f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "temproles" })
    assert.equal(snapshot.configRevision, 2)
    if (snapshot.family !== "temproles") throw new Error("Wrong family")
    assert.deepEqual(snapshot.data.settings.roles.map(row => [row.roleId, row.defaultSeconds, row.maxSeconds]), [["40", 7 * 86400, 30 * 86400], ["41", 3600, undefined]])
    assert.deepEqual(snapshot.data.grants.map(row => row.roleId), ["40"])
    // A chat change older than the dashboard change is refused, and both nulls remove a role's defaults
    assert.equal((await role({ defaultSeconds: null, maxSeconds: null })).status, 409)
    now += 1000
    assert.deepEqual((await (await role({ defaultSeconds: null, maxSeconds: null })).json()).settings.roles.map((row: { roleId: string }) => row.roleId), ["41"])
})

test("The setup check reports temporary roles and the roles they assign", async () => {
    const f = await fixture()
    const status = async () => await f.call("/setup/status", {}) as { sections: Array<{ id: string, state: string }>, managedRoles: Array<{ feature: string, roleIds: string[] }> }
    assert.equal((await status()).sections.find(row => row.id === "temproles")?.state, "off")
    await f.give("42")
    const current = await status()
    assert.equal(current.sections.find(row => row.id === "temproles")?.state, "on")
    assert.deepEqual(current.managedRoles.find(row => row.feature === "temproles")?.roleIds, ["42"])
})
