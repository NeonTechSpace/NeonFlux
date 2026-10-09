import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { ModerationActor, RolePickerJob, RolePickerMemberOperation, RolePickerRoleDisplay, RolesGrant, RolesMemberContext, RolesRoleSnapshot } from "../contracts.js"

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const secret = "synthetic-rolepicker-secret-not-a-credential-0000"
const scopeKeys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const prior = Object.fromEntries(scopeKeys.map(key => [key, process.env[key]]))
const MINUTE = 60000
let now = 0, guilds: Array<Record<string, unknown>> = [], providerUrls: string[] = []
beforeEach(() => {
    providerUrls = []
    now = 1700000000000
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    delete process.env.NEONFLUX_SERVER_ID; delete process.env.NEONFLUX_SERVER_IDS
    process.env.NEONFLUX_SERVER_MODE = "multi"; process.env.FLUXER_CLIENT_ID = "30"; process.env.NEONFLUX_BOT_API_SECRET = secret
    guilds = [{ id: "10", name: "Member server", icon: null, owner_id: "99", permissions: "0" }, { id: "11", name: "Picker off", icon: null, owner_id: "99", permissions: "0" },
        { id: "12", name: "Not installed", icon: null, owner_id: "99", permissions: "0" }, { id: "13", name: "Managed", icon: null, owner_id: "99", permissions: "32" }]
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        providerUrls.push(url)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-provider-token")
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Synthetic member" } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json(guilds)
        // Member role picker reads never send the member's token to a guild route
        throw new Error("Unexpected synthetic provider route")
    })
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of scopeKeys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})

const owner = (serverId = "10"): ModerationActor => ({ originServerId: serverId, userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true })
const member = (serverId = "10"): ModerationActor => ({ originServerId: serverId, userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true })
const snapshots = (serverId = "10", change: (role: RolesRoleSnapshot) => RolesRoleSnapshot = role => role) =>
    Array.from({ length: 40 }, (_, index) => change({ originServerId: serverId, roleId: String(40 + index), permissions: "0", botCanManage: true, actorCanManage: true }))
const context = (roleIds: string[], serverId = "10"): RolesMemberContext => ({ originServerId: serverId, userId: "20", joinedAt: "2023-11-14T22:13:19.000Z", roleIds, isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles: snapshots(serverId) })
// The server's role names as the bot reads them: Every menu-capable role plus roles that sit in no menu
const serverRoles = (rename = ""): RolePickerRoleDisplay[] => [...Array.from({ length: 40 }, (_, index) => ({ roleId: String(40 + index), name: `${rename}Role ${40 + index}`, color: index })),
    { roleId: "90", name: "Hidden staff", color: 255 }, { roleId: "91", name: "Private", color: 0 }]
const statusOf = (error: unknown) => error instanceof ConvexError ? (error.data as { status?: number }).status : undefined

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true })
    let sequence = 1000, request = 0
    const raw = (path: string, body: Record<string, unknown>, serverId = "10") => t.fetch(path, { method: "POST", body: JSON.stringify({ serverId, ...body }),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "X-NeonFlux-Server-ID": serverId } })
    const ok = async (response: Response) => { assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const http = async (path: string, body: Record<string, unknown>, serverId = "10") => ok(await raw(path, body, serverId))
    const installation = (operation: "join" | "leave", serverId: string) => t.fetch(`/service/installations/${operation}`, { method: "POST", body: JSON.stringify({ serverId }),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" } })
    for (const serverId of ["10", "11", "13"]) assert.equal((await installation("join", serverId)).status, 200)
    const manageRequest = (operation: unknown, serverId = "10", actor = owner(serverId), roles = snapshots(serverId), display = serverRoles()) => raw("/rolepicker/manage", { messageId: String(++sequence), createdAt: now, actor, roles, display, operation }, serverId)
    const manage = async (operation: unknown, serverId = "10", actor = owner(serverId), roles = snapshots(serverId), display = serverRoles()) => ok(await manageRequest(operation, serverId, actor, roles, display))
    const admit = () => t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    const ask = (sessionToken: string, operation: RolePickerMemberOperation, serverId = "10") =>
        t.mutation(api.rolePicker.request, { sessionToken, serverId, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`, operation })
    const view = (sessionToken: string, serverId = "10") => t.query(api.rolePicker.member, { sessionToken, serverId })
    // The bot's member flow: fresh read, start, the shared role lifecycle with native writes, then the read after the change
    const run = async (jobId: string, roleIds: string[], outcome: "succeeded" | "uncertain" = "succeeded", display = serverRoles()): Promise<{ job: RolePickerJob, roleIds: string[] }> => {
        const ready = await http("/rolepicker/ready", {}) as { jobs: RolePickerJob[] }, job = ready.jobs.find(row => row.id === jobId)
        assert.ok(job, "Request is ready for the bot")
        const started = await http("/rolepicker/start", { jobId, actorId: "20", context: context(roleIds), display })
        if (!started.proceed) return { job: started.job, roleIds }
        const op = job.operation as Exclude<RolePickerMemberOperation, { type: "lookup" }>
        let current = [...roleIds], continuationAttemptId: string | undefined
        for (let step = 0; step < 4; step++) {
            const evaluated = await http("/roles/evaluate", { sourceId: `picker_${jobId}`, createdAt: job.createdAt, context: context(current),
                operation: { type: "pick", jobId, menu: op.menu, roleId: op.roleId, selected: op.type === "claim" }, ...(continuationAttemptId ? { continuationAttemptId } : {}) })
            const grant = evaluated.grant as RolesGrant | undefined
            if (!grant) break
            const binding = { attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId }, claimToken = "c".repeat(32)
            assert.equal((await http("/roles/dispatch", { ...binding, claimToken, context: context(current) })).claimed, true)
            await http("/roles/outcome", { ...binding, claimToken, outcome })
            if (outcome !== "succeeded") break
            current = grant.action === "add" ? [...current, grant.roleId] : current.filter(id => id !== grant.roleId)
            continuationAttemptId = grant.attemptId
        }
        return { job: (await http("/rolepicker/complete", { jobId, actorId: "20", context: context(current), display })).job, roleIds: current }
    }
    // The servers the bot's one work dispatcher would wake for dashboard jobs
    const dueDashboard = async () => ((await (await t.fetch("/service/work", { method: "POST", body: JSON.stringify({ cursor: null }),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" } })).json()) as { kinds: { dashboard: string[] } }).kinds.dashboard
    return { t, raw, http, manage, manageRequest, installation, admit, ask, view, run, dueDashboard }
}

test("Member sign-in lists installed servers with the role picker on, and managers keep the manager list", async () => {
    const f = await fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "module", enabled: true }, "13")
    const admitted = await f.admit()
    assert.deepEqual(admitted.servers.map(server => server.id), ["13"])
    assert.deepEqual(admitted.memberServers?.map(server => server.id), ["10"])
    const stored = (await f.t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!
    assert.deepEqual([stored.servers, stored.memberServers], [[{ id: "13", name: "Managed" }], [{ id: "10", name: "Member server" }]])
    // Members never reach manager functions, and member reads stay inside the member list
    await assert.rejects(f.t.query(api.dashboard.snapshot, { sessionToken: admitted.sessionToken, serverId: "10" }), error => statusOf(error) === 403)
    for (const serverId of ["11", "12"]) await assert.rejects(f.view(admitted.sessionToken, serverId), error => statusOf(error) === 403)
    assert.deepEqual((await f.view(admitted.sessionToken)).menus, [])
    // Turning the picker on for server 11 shows it at the next sign-in refresh
    await f.manage({ type: "module", enabled: true }, "11")
    const refreshed = await f.t.action(api.dashboard.refresh, { sessionToken: admitted.sessionToken })
    assert.deepEqual(refreshed.memberServers?.map(server => server.id), ["10", "11"])
    // Manager writes renew the session without changing member access
    await f.t.mutation(internal.dashboard.renew, { sessionToken: admitted.sessionToken, user: { id: "20", name: "Synthetic member" }, servers: [{ id: "13", name: "Managed", icon: null }] })
    assert.deepEqual((await f.t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!.memberServers?.map(server => server.id), ["10", "11"])
    // The member's token reaches Fluxer only for sign-in, never for server roles
    assert.equal(providerUrls.some(url => url.includes("/v1/guilds/")), false)
    // A disabled picker and a removed installation reject member requests on every request
    await f.manage({ type: "module", enabled: false }, "11")
    await assert.rejects(f.ask(admitted.sessionToken, { type: "lookup" }, "11"), error => statusOf(error) === 403)
    assert.equal((await f.installation("leave", "10")).status, 200)
    await assert.rejects(f.ask(admitted.sessionToken, { type: "lookup" }), error => statusOf(error) === 403)
    await assert.rejects(f.view(admitted.sessionToken), error => statusOf(error) === 403)
    const denied = await f.raw("/rolepicker/ready", {})
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
})

test("Menus keep their limits, reject unsafe roles and share one revision between chat and the dashboard", async () => {
    const f = await fixture()
    guilds = guilds.map(guild => guild.id === "10" ? { ...guild, permissions: "32" } : guild)
    const settings = async () => (await f.http("/rolepicker/settings", { actor: owner() })) as { revision: number, settings: { enabled: boolean, menus: Array<{ name: string, mode: string, description?: string, roleIds: string[], display?: RolePickerRoleDisplay[] }> } }
    const names = async (menu: string) => (await settings()).settings.menus.find(row => row.name === menu)?.display?.map(role => role.name)
    for (let index = 0; index < 10; index++) await f.manage({ type: "menu-add", name: `menu${index}`, mode: "multi" })
    assert.equal((await f.manageRequest({ type: "menu-add", name: "menu10", mode: "multi" })).status, 429)
    assert.equal((await f.manageRequest({ type: "menu-add", name: "menu0", mode: "single" })).status, 409)
    await f.manage({ type: "menu-role-add", name: "menu0", roleIds: Array.from({ length: 25 }, (_, index) => String(40 + index)) })
    assert.equal((await f.manageRequest({ type: "menu-role-add", name: "menu0", roleIds: ["70"] })).status, 400)
    assert.equal((await f.manageRequest({ type: "menu-role-add", name: "menu1", roleIds: ["40"] })).status, 409)
    // The shared self-service rules refuse roles above the bot, staff permissions and staff roles
    const unsafe = [snapshots("10", role => role.roleId === "70" ? { ...role, botCanManage: false } : role), snapshots("10", role => role.roleId === "70" ? { ...role, permissions: "8" } : role),
        snapshots("10", role => role.roleId === "70" ? { ...role, permissions: String(1n << 28n) } : role), snapshots("10", role => role.roleId === "70" ? { ...role, actorCanManage: false } : role)]
    for (const roles of unsafe) assert.equal((await f.manageRequest({ type: "menu-role-add", name: "menu1", roleIds: ["70"] }, "10", owner(), roles)).status, 403)
    assert.equal((await f.manageRequest({ type: "menu-role-add", name: "menu1", roleIds: ["10"] })).status, 403)
    assert.equal((await f.manageRequest({ type: "menu-add", name: "other", mode: "multi" }, "10", member())).status, 403)
    await f.manage({ type: "menu-update", name: "menu1", mode: "single", description: "Pick one colour" })
    await f.manage({ type: "menu-role-remove", name: "menu0", roleIds: ["64"] })
    await f.manage({ type: "menu-remove", name: "menu9" })
    let current = await settings()
    assert.equal(current.revision, 14)
    assert.equal(current.settings.menus.length, 9)
    assert.deepEqual(current.settings.menus.find(menu => menu.name === "menu1"), { name: "menu1", mode: "single", roleIds: [], description: "Pick one colour" })
    assert.equal(current.settings.menus[0]!.roleIds.length, 24)
    // Each save stores the names the bot read for the menu roles only, as the member view's fallback
    assert.deepEqual(current.settings.menus[0]!.display, serverRoles().filter(role => current.settings.menus[0]!.roleIds.includes(role.roleId)))
    assert.equal(current.settings.menus.some(menu => menu.display?.some(role => ["90", "91"].includes(role.roleId))), false)
    // The dashboard edits the same settings through a queued job that the bot executes with fresh native role snapshots
    const admitted = await f.admit(), sessionToken = admitted.sessionToken
    const queue = (operation: unknown, expectedConfigRevision: number, id: number) => f.t.action(api.dashboardConfiguration.queue, { sessionToken, serverId: "10", family: "rolepicker", requestId: `00000000-0000-4000-8000-00000000010${id}`, expectedConfigRevision, operation })
    const execute = (jobId: string, referenced: string[], roles?: RolesRoleSnapshot[]) => f.t.mutation(internal.dashboardConfiguration.execute, { request: { serverId: "10", originServerId: "10", jobId, actorId: "20", managerAuthorized: true, observedAt: now,
        actor: member(), ...(roles ? { roles } : {}), display: serverRoles("New "), references: referenced.map(id => ({ id, type: "role", serverId: "10", exists: true })) } })
    assert.deepEqual(await queue({ type: "module", enabled: true }, 0, 1), { queued: false, conflict: true, revision: 14 })
    const unsafeSave = await queue({ type: "menu-set", name: "menu1", mode: "single", roleIds: ["70"] }, 14, 2)
    await assert.rejects(execute(unsafeSave.jobId!, ["70"], snapshots("10", role => role.roleId === "70" ? { ...role, permissions: "8" } : role)), error => statusOf(error) === 403)
    await f.http("/dashboard-configuration/fail", { jobId: unsafeSave.jobId })
    const saved = await queue({ type: "menu-set", name: "menu1", mode: "single", description: "Colours", roleIds: ["70", "71"] }, 14, 3)
    assert.equal((await execute(saved.jobId!, ["70", "71"], snapshots())).job.state, "applied")
    const access = await queue({ type: "access-set", allowRoleIds: [], blockRoleIds: ["72"], allowUserIds: [], blockUserIds: ["21"] }, 15, 4)
    assert.equal((await execute(access.jobId!, ["72"])).job.state, "applied")
    current = await settings()
    assert.equal(current.revision, 16)
    assert.deepEqual(current.settings.menus.find(menu => menu.name === "menu1"), { name: "menu1", mode: "single", roleIds: ["70", "71"], description: "Colours",
        display: [{ roleId: "70", name: "New Role 70", color: 30 }, { roleId: "71", name: "New Role 71", color: 31 }] })
    // Names refresh on every save, including saves that only change access lists
    assert.equal((await names("menu0"))?.[0], "New Role 40")
    const snapshot = await f.t.query(api.dashboardConfiguration.snapshot, { sessionToken, serverId: "10", family: "rolepicker" })
    assert.equal(snapshot.configRevision, 16)
    assert.deepEqual(snapshot.family === "rolepicker" && snapshot.data.access, { allowRoleIds: [], blockRoleIds: ["72"], allowUserIds: [], blockUserIds: ["21"] })
    // Chat sees the dashboard change and adds to the same lists. A chat message older than the dashboard change is refused
    assert.equal((await f.manageRequest({ type: "access-add", list: "allow", kind: "role", ids: ["73"] })).status, 409)
    now += 1
    await f.manage({ type: "access-add", list: "allow", kind: "role", ids: ["73"] }, "10", owner(), snapshots(), serverRoles("Chat "))
    assert.deepEqual((await settings() as unknown as { access: unknown }).access, { allowRoleIds: ["73"], blockRoleIds: ["72"], allowUserIds: [], blockUserIds: ["21"] })
    assert.deepEqual(await names("menu1"), ["Chat Role 70", "Chat Role 71"])
    assert.equal((await f.manageRequest({ type: "access-add", list: "block", kind: "role", ids: ["10"] })).status, 400)
})

test("Access lists let a block win, and an empty allow list admits everyone else", async () => {
    const f = await fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "menu-add", name: "colors", mode: "multi" })
    await f.manage({ type: "menu-role-add", name: "colors", roleIds: ["40", "41"] })
    const { sessionToken } = await f.admit()
    const allowed = async (roleIds: string[]) => {
        const { jobId } = await f.ask(sessionToken, { type: "lookup" })
        assert.equal((await f.run(jobId, roleIds)).job.state, "applied")
        return (await f.view(sessionToken)).snapshot?.allowed
    }
    assert.equal(await allowed(["50"]), true)
    await f.manage({ type: "access-add", list: "allow", kind: "role", ids: ["51"] })
    assert.equal((await f.view(sessionToken)).snapshot?.allowed, false)
    assert.equal(await allowed(["51"]), true)
    await f.manage({ type: "access-add", list: "block", kind: "role", ids: ["52"] })
    assert.equal(await allowed(["51", "52"]), false)
    await f.manage({ type: "access-remove", list: "block", kind: "role", ids: ["52"] })
    await f.manage({ type: "access-add", list: "allow", kind: "user", ids: ["20"] })
    await f.manage({ type: "access-add", list: "block", kind: "user", ids: ["20"] })
    assert.equal(await allowed(["51"]), false)
    const { jobId } = await f.ask(sessionToken, { type: "claim", menu: "colors", roleId: "40" })
    const refused = await f.run(jobId, ["51"])
    assert.deepEqual([refused.job.state, refused.job.error], ["failed", "You cannot use the role picker in this server"])
    assert.equal(await f.t.run(ctx => ctx.db.query("roleAttempts").first()), null)
})

test("Claims, drops and single-choice swaps use the shared role lifecycle and never strip roles they did not add", async () => {
    const f = await fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "menu-add", name: "colors", mode: "single", description: "One colour" })
    await f.manage({ type: "menu-role-add", name: "colors", roleIds: ["40", "41"] })
    await f.manage({ type: "menu-add", name: "games", mode: "multi" })
    await f.manage({ type: "menu-role-add", name: "games", roleIds: ["45", "46"] })
    const { sessionToken } = await f.admit()
    const claim = async (menu: string, roleId: string, roleIds: string[], type: "claim" | "drop" = "claim") => {
        const { jobId } = await f.ask(sessionToken, { type, menu, roleId })
        assert.equal((await f.view(sessionToken)).requests.find(row => row.id === jobId)?.state, "queued")
        return f.run(jobId, roleIds)
    }
    let result = await claim("colors", "40", [])
    assert.deepEqual([result.job.state, result.roleIds], ["applied", ["40"]])
    result = await claim("colors", "41", result.roleIds)
    assert.deepEqual([result.job.state, result.roleIds], ["applied", ["41"]])
    result = await claim("games", "45", result.roleIds)
    result = await claim("games", "46", result.roleIds)
    assert.deepEqual(result.roleIds, ["41", "45", "46"])
    result = await claim("games", "45", result.roleIds, "drop")
    assert.deepEqual([result.job.state, result.roleIds], ["applied", ["41", "46"]])
    // The website shows the selections from the member's latest read
    const shown = await f.view(sessionToken)
    assert.deepEqual(shown.snapshot?.roleIds, ["41", "46"])
    assert.deepEqual(shown.requests.map(row => row.state), ["applied", "applied", "applied", "applied", "applied"])
    // A role the member got elsewhere is never removed by a drop, and a swap refuses to strip it
    const manual = await claim("colors", "40", ["41", "46", "40"], "drop")
    assert.deepEqual([manual.job.state, manual.job.error, manual.roleIds], ["failed", "The role picker did not add this role, so it cannot remove it", ["41", "46", "40"]])
    const blocked = await claim("colors", "41", ["46", "40"])
    assert.equal(blocked.job.state, "failed")
    assert.match(blocked.job.error!, /Ask a moderator to remove it first/)
    // An uncertain native outcome fails the request and is never retried
    const { jobId } = await f.ask(sessionToken, { type: "claim", menu: "games", roleId: "45" })
    const uncertain = await f.run(jobId, ["46"], "uncertain")
    assert.deepEqual([uncertain.job.state, uncertain.job.error], ["failed", "Fluxer did not confirm the role change, and it is never retried automatically. Check your roles before trying again"])
    const attempts = await f.t.run(ctx => ctx.db.query("roleAttempts").collect())
    assert.ok(attempts.every(row => row.consumerKey.startsWith("picker:")))
    assert.equal(attempts.filter(row => row.sourceId === `picker_${jobId}`).length, 1)
})

test("Lookups store role IDs and menu role names for ten minutes, and requests keep IDs and outcomes for one day", async () => {
    const f = await fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "menu-add", name: "colors", mode: "multi" })
    await f.manage({ type: "menu-role-add", name: "colors", roleIds: ["40", "41"] })
    const { sessionToken } = await f.admit()
    // Without queued requests the work dispatcher wakes nothing, and a queued request wakes its server's dashboard worker
    assert.deepEqual(await f.dueDashboard(), [])
    const { jobId } = await f.ask(sessionToken, { type: "lookup" })
    assert.deepEqual(await f.dueDashboard(), ["10"])
    // The bot sends every server role it read. Only names of menu roles are kept, never roles outside the menus
    assert.equal((await f.run(jobId, ["40", "50", "90"], "succeeded", serverRoles("Fresh "))).job.state, "applied")
    assert.deepEqual(await f.dueDashboard(), [])
    const rows = await f.t.run(ctx => ctx.db.query("rolePickerSnapshots").collect())
    const menuNames = [{ roleId: "40", name: "Fresh Role 40", color: 0 }, { roleId: "41", name: "Fresh Role 41", color: 1 }]
    assert.deepEqual(rows.map(row => [row.userId, row.roleIds, row.roles, row.expiresAt - row.observedAt]), [["20", ["40", "50", "90"], menuNames, 600000]])
    const viewed = await f.view(sessionToken)
    assert.deepEqual([viewed.snapshot?.roleIds, viewed.snapshot?.roles], [["40"], menuNames])
    // The names stored with the menu stay as the fallback, and the member's token never reads server roles
    assert.deepEqual(viewed.menus[0]!.display, [{ roleId: "40", name: "Role 40", color: 0 }, { roleId: "41", name: "Role 41", color: 1 }])
    assert.equal(JSON.stringify(viewed).includes("Hidden staff"), false)
    assert.equal(providerUrls.some(url => url.includes("/v1/guilds/")), false)
    // Removing a role from the menu removes its name from the member view at once
    await f.manage({ type: "menu-role-remove", name: "colors", roleIds: ["41"] })
    assert.deepEqual((await f.view(sessionToken)).snapshot?.roles, [menuNames[0]])
    // An open dashboard tab refreshes its sign-in every four minutes. The snapshot is gone once ten minutes pass
    for (const step of [4, 4, 2]) { now += step * MINUTE; await f.t.action(api.dashboard.refresh, { sessionToken }) }
    assert.equal((await f.view(sessionToken)).snapshot, null)
    await f.t.finishAllScheduledFunctions(() => mock.timers.tick(MINUTE))
    assert.deepEqual(await f.t.run(ctx => ctx.db.query("rolePickerSnapshots").collect()), [])
    const job = (await f.t.run(ctx => ctx.db.query("dashboardConfigurationJobs").collect()))[0]!
    assert.deepEqual(Object.keys(job).sort(), ["_creationTime", "_id", "actorId", "cleanupAt", "createdAt", "expectedConfigRevision", "expiresAt", "family", "operation", "requestId", "serverId", "sessionId", "state"])
    assert.deepEqual([job.state, job.operation, job.cleanupAt - job.createdAt], ["applied", { type: "lookup" }, 86400000])
    // An unanswered request fails at its deadline instead of waiting for the bot
    const late = await f.ask(sessionToken, { type: "lookup" })
    assert.deepEqual(await f.dueDashboard(), ["10"])
    now += 2 * MINUTE
    // An expired request wakes nothing, as the bot's ready route would skip it
    assert.deepEqual([await f.dueDashboard(), (await f.http("/rolepicker/ready", {})).jobs], [[], []])
    await f.t.finishAllScheduledFunctions(() => mock.timers.tick(MINUTE))
    const expired = await f.t.run(ctx => ctx.db.get(late.jobId as never)) as { state: string, error: string }
    assert.deepEqual([expired.state, expired.error], ["failed", "The bot did not handle this request in time. Try again"])
    // The shared dashboard job cleanup removes the record after one day
    now = job.cleanupAt
    await f.t.mutation(internal.dashboardConfiguration.cleanup, { id: job._id })
    assert.equal(await f.t.run(ctx => ctx.db.get(job._id)), null)
})

test("Member requests are rate limited per member and bounded per server", async () => {
    const f = await fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "menu-add", name: "colors", mode: "multi" })
    await f.manage({ type: "menu-role-add", name: "colors", roleIds: ["40"] })
    const { sessionToken } = await f.admit()
    const settle = async (jobId: string) => f.http("/rolepicker/fail", { jobId })
    for (let index = 0; index < 10; index++) await settle((await f.ask(sessionToken, { type: index % 2 ? "drop" : "claim", menu: "colors", roleId: "40" })).jobId)
    await assert.rejects(f.ask(sessionToken, { type: "claim", menu: "colors", roleId: "40" }), error => statusOf(error) === 429)
    // Lookups have their own allowance, so a busy member can still refresh what they hold
    await settle((await f.ask(sessionToken, { type: "lookup" })).jobId)
    await assert.rejects(f.ask(sessionToken, { type: "claim", menu: "colors", roleId: "41" }), error => statusOf(error) === 400)
    now += MINUTE + 1
    await f.t.action(api.dashboard.refresh, { sessionToken })
    for (let index = 0; index < 3; index++) await f.ask(sessionToken, { type: "claim", menu: "colors", roleId: "40" })
    await assert.rejects(f.ask(sessionToken, { type: "claim", menu: "colors", roleId: "40" }), error => statusOf(error) === 429)
    // Other members' queued requests fill the server queue
    const session = (await f.t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!
    now += 1
    await f.t.run(async ctx => { for (let index = 0; index < 50; index++) await ctx.db.insert("dashboardConfigurationJobs", { serverId: "10", family: "member", actorId: String(500 + index), sessionId: session._id, requestId: `synthetic-${index}`,
        expectedConfigRevision: 0, operation: { type: "lookup" }, state: "queued", createdAt: now, expiresAt: now + 120000, cleanupAt: now + 86400000 }) })
    const ready = await f.http("/rolepicker/ready", {}) as { jobs: RolePickerJob[] }
    assert.deepEqual(ready.jobs.map(job => job.actorId), ["20", "20", "20", "500"])
    for (const job of ready.jobs.filter(row => row.actorId === "20")) await settle(job.id)
    await assert.rejects(f.ask(sessionToken, { type: "lookup" }), (error: unknown) => statusOf(error) === 429 && /busy/.test(String((error as ConvexError<{ error: string }>).data.error)))
    // Manager configuration jobs ignore the member queue
    const configuration = await f.http("/dashboard-configuration/ready", {}) as { jobs: unknown[] }
    assert.deepEqual(configuration.jobs, [])
})
