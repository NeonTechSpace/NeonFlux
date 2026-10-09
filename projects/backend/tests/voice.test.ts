import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { defaultSettings } from "../convex/moderationDomain.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-voice-test-secret-not-a-credential-000"
let clock = now
beforeEach(() => {
    clock = now
    mock.timers.enable({ apis: ["setTimeout"] }); mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"; process.env.FLUXER_CLIENT_ID = "30"; process.env.NEONFLUX_BOT_API_SECRET = secret
    delete process.env.NEONFLUX_SERVER_MODE; delete process.env.NEONFLUX_SERVER_IDS
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Manager", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"]) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]
})
const modules = Object.fromEntries(["voice", "dashboard", "dashboardConfiguration", "metadataLogs", "http", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = (userId: string, fields: Record<string, unknown> = {}) => ({ originServerId: "10", userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false, ...fields })
const owner = actor("99", { isOwner: true, nativePermissionAuthorized: true })
const add = (channelId: string, fields: Record<string, unknown> = {}) => ({ type: "generator-add", channelId, channelName: "Join to create", categoryId: "40", template: "{owner}'s room", userLimit: null, region: null, ...fields })

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await t.fetch(path, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result)); assert(!JSON.stringify(result).includes(secret))
        return result
    }
    const manage = (operation: unknown, who: unknown = owner, expected = 200) => post("/voice/manage", { serverId: "10", messageId: String(++sequence), createdAt: clock, actor: who, operation }, expected)
    const query = (operation: unknown, expected = 200) => post("/voice/query", { serverId: "10", operation }, expected)
    const rooms = (operation: unknown, expected = 200) => post("/voice/rooms", { serverId: "10", operation }, expected)
    const staffRole = async (roleId: string) => t.run(async ctx => { await ctx.db.insert("moderationSettings", { serverId: "10", config: { ...defaultSettings(), staffRoleIds: { ...defaultSettings().staffRoleIds, moderation: [roleId] } }, nextCaseNo: 1, nextAppealNo: 1 }) })
    return { t, post, manage, query, rooms, staffRole }
}

test("Generator management follows the moderation staff rule for channel management", async () => {
    const f = await fixture()
    await f.staffRole("70")
    await f.manage(add("50"), actor("21"), 403)
    // A staff role without a fresh native Manage Channels read is not enough, as for slowmode
    await f.manage(add("50"), actor("22", { roleIds: ["70"] }), 403)
    assert.equal((await f.manage(add("50"), actor("22", { roleIds: ["70"], nativePermissionAuthorized: true }))).generator.channelId, "50")
    assert.equal((await f.manage(add("51"), actor("23", { isAdministrator: true }))).generator.channelId, "51")
    const authority = await f.query({ type: "authority", actor: actor("21") })
    assert.equal(authority.staff, false); assert.equal(authority.room, null); assert.equal(authority.generators.length, 2)
    assert.equal((await f.query({ type: "authority", actor: actor("22", { roleIds: ["70"], nativePermissionAuthorized: true }) })).staff, true)
    // Evidence read from another server never authorizes this one
    await f.manage(add("52"), { ...owner, originServerId: "11" }, 403)
    await f.t.run(async ctx => { const row = (await ctx.db.query("moderationSettings").first())!; await ctx.db.patch(row._id, { config: { ...row.config, defcon: 1 } }) })
    await f.manage(add("53"), actor("22", { roleIds: ["70"], nativePermissionAuthorized: true }), 403)
})

test("Generator settings validate like text settings and the server keeps at most ten generators", async () => {
    const f = await fixture()
    const created = (await f.manage(add("50"))).generator
    assert.deepEqual({ ...created, createdAt: 0, updatedAt: 0 }, { channelId: "50", categoryId: "40", template: "{owner}'s room", userLimit: null, region: null, revision: 1, createdAt: 0, updatedAt: 0 })
    await f.manage(add("50"), owner, 409)
    for (const invalid of [{ template: "{user}'s room" }, { template: "" }, { template: "x".repeat(101) }, { userLimit: 0 }, { userLimit: 100 }, { region: "eu central" }, { channelName: " \u202e " }, { categoryId: "abc" }]) await f.manage(add("59", invalid), owner, 400)
    const updated = (await f.manage({ type: "generator-set", channelId: "50", patch: { channelName: "Gaming", categoryId: null, template: "{owner} plays", userLimit: 5, region: "us-east" } })).generator
    assert.deepEqual([updated.categoryId, updated.template, updated.userLimit, updated.region, updated.revision], [null, "{owner} plays", 5, "us-east", 2])
    assert.equal("channelName" in updated, false)
    await f.manage({ type: "generator-set", channelId: "50", expectedRevision: 1, patch: { userLimit: 6 } }, owner, 409)
    await f.manage({ type: "generator-set", channelId: "50", patch: {} }, owner, 400)
    await f.manage({ type: "generator-set", channelId: "58", patch: { userLimit: 6 } }, owner, 404)
    assert.equal((await f.manage({ type: "generator-set", channelId: "50", patch: { region: null, userLimit: null } })).generator.region, null)
    for (let index = 1; index < 10; index++) await f.manage(add(String(60 + index)))
    await f.manage(add("80"), owner, 429)
    assert.deepEqual(await f.manage({ type: "generator-remove", channelId: "50" }), { type: "removed", channelId: "50" })
    await f.manage({ type: "generator-remove", channelId: "50" }, owner, 404)
    assert.equal((await f.manage(add("80"))).generator.channelId, "80")
    assert.equal((await f.query({ type: "state" })).generators.length, 10)
})

test("Rooms are one per owner, capped at fifty, and forgetting a deleted channel clears its record", async () => {
    const f = await fixture()
    await f.manage(add("50"))
    assert.deepEqual(await f.rooms({ type: "create", channelId: "100", ownerId: "21", generatorChannelId: "59" }), { type: "refused", reason: "generator" })
    const room = (await f.rooms({ type: "create", channelId: "100", ownerId: "21", generatorChannelId: "50" })).room
    assert.deepEqual(room, { channelId: "100", ownerId: "21", generatorChannelId: "50", createdAt: now })
    assert.deepEqual(await f.rooms({ type: "create", channelId: "101", ownerId: "21", generatorChannelId: "50" }), { type: "refused", reason: "owner", room })
    await f.rooms({ type: "create", channelId: "50", ownerId: "22", generatorChannelId: "50" }, 409)
    await f.manage(add("100"), owner, 409)
    assert.deepEqual((await f.query({ type: "authority", actor: actor("21") })).room, room)
    assert.deepEqual((await f.query({ type: "authority", actor: actor("22"), channelId: "100" })).room, room)
    for (let index = 1; index < 50; index++) await f.rooms({ type: "create", channelId: String(200 + index), ownerId: String(300 + index), generatorChannelId: "50" })
    assert.deepEqual(await f.rooms({ type: "create", channelId: "400", ownerId: "401", generatorChannelId: "50" }), { type: "refused", reason: "room-limit" })
    assert.deepEqual(await f.rooms({ type: "forget", channelId: "100" }), { type: "forgotten", room: true, generator: false })
    assert.deepEqual(await f.rooms({ type: "forget", channelId: "100" }), { type: "forgotten", room: false, generator: false })
    assert.equal((await f.rooms({ type: "create", channelId: "400", ownerId: "21", generatorChannelId: "50" })).room.channelId, "400")
    assert.deepEqual(await f.rooms({ type: "forget", channelId: "50" }), { type: "forgotten", room: false, generator: true })
    const state = await f.query({ type: "state" })
    assert.equal(state.generators.length, 0); assert.equal(state.rooms.length, 50)
    await f.rooms({ type: "rename", channelId: "400" }, 400)
})

test("Dashboard generator changes store the same settings as chat commands", async () => {
    const f = await fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-voice-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = () => f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "voice" })
    let request = 0
    const apply = async (operation: DashboardConfigurationOperationMap["voice"], extra: Record<string, unknown> = {}) => {
        const job = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "voice", operation, expectedConfigRevision: (await snapshot()).configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` })
        assert(job.jobId)
        return f.post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor: actor("20", { nativePermissionAuthorized: true }), ...extra })
    }
    const references = (...ids: string[]) => ids.map(id => ({ id, type: "channel", serverId: "10", exists: true }))
    const settings = { channelName: "Join to create", categoryId: "40", template: "{owner} hangout", userLimit: 4, region: "eu-west" }
    assert.equal((await apply({ type: "generator-add", ...settings }, { context: { originServerId: "10", channelId: "50" }, references: references("40") })).job.state, "applied")
    clock += 1000
    const chat = (await f.manage({ ...add("51"), ...settings })).generator
    const view = await snapshot()
    assert.equal(view.family, "voice"); if (view.family !== "voice") throw new Error("Wrong family")
    const [dashboard] = view.data.generators.filter(generator => generator.channelId === "50")
    const comparable = (generator: typeof chat) => ({ categoryId: generator.categoryId, template: generator.template, userLimit: generator.userLimit, region: generator.region, revision: generator.revision })
    assert.deepEqual(comparable(dashboard!), comparable(chat)); assert.equal(view.data.rooms, 0)
    // The bot must name the channel it created for an add request
    const missing = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "voice", operation: { type: "generator-add", ...settings }, expectedConfigRevision: view.configRevision, requestId: "00000000-0000-4000-8000-999999999999" })
    await f.post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: missing.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor: actor("20", { nativePermissionAuthorized: true }), references: references("40") }, 400)
    await f.post("/dashboard-configuration/fail", { serverId: "10", jobId: missing.jobId })
    const patch = { channelName: "Gaming", categoryId: null, template: "{owner} plays", userLimit: null, region: null }
    assert.equal((await apply({ type: "generator-set", channelId: "50", expectedRevision: 1, patch }, { references: references("50") })).job.state, "applied")
    clock += 1000
    const chatSet = (await f.manage({ type: "generator-set", channelId: "51", patch })).generator
    const after = await snapshot(); if (after.family !== "voice") throw new Error("Wrong family")
    assert.deepEqual(comparable(after.data.generators.find(generator => generator.channelId === "50")!), comparable(chatSet))
    assert.equal((await apply({ type: "generator-remove", channelId: "50", expectedRevision: 2 })).job.state, "applied")
    const removed = await snapshot(); if (removed.family !== "voice") throw new Error("Wrong family")
    assert.deepEqual(removed.data.generators.map(generator => generator.channelId), ["51"])
})
