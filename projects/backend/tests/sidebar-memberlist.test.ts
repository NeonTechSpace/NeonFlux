import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-sidebar-test-secret-not-a-credential-0"
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
const modules = Object.fromEntries(["sidebar", "memberList", "dashboard", "dashboardConfiguration", "dashboardViews", "metadataLogs", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = (fields: Record<string, unknown> = {}) => ({ originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true, ...fields })

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000, request = 0
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const chat = (path: string, operation: unknown, expected = 200, who = actor()) => post(path, { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor: who, managerAuthorized: true, operation }, expected)
    const revision = (family: string) => t.run(async ctx => (await ctx.db.query("serverConfigurationRevisions").filter(q => q.eq(q.field("family"), family)).first())?.revision ?? 0)
    const dashboard = async () => {
        const session = await t.action(api.dashboard.admit, { accessToken: "synthetic-sidebar-provider-token" })
        return { sessionToken: session.sessionToken, serverId: "10" }
    }
    const apply = async <F extends "sidebar" | "memberlist">(args: { sessionToken: string, serverId: string }, family: F, operation: DashboardConfigurationOperationMap[F], extra: Record<string, unknown> = {}, expected = 200) => {
        const configRevision = (await t.query(api.dashboardConfiguration.snapshot, { ...args, family })).configRevision
        const job = await t.action(api.dashboardConfiguration.queue, { ...args, family, operation, expectedConfigRevision: configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` } as never)
        return post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor: actor(), ...extra }, expected)
    }
    return { t, post, chat, revision, dashboard, apply }
}

test("A server records one dashboard link, renamed and removed through chat and the dashboard alike", async () => {
    const f = await fixture()
    assert.deepEqual(await f.post("/sidebar/get", { serverId: "10" }), { link: null })
    await f.chat("/sidebar/manage", { type: "set", name: "Dashboard" }, 404)
    for (const invalid of [{ name: "" }, { name: "x".repeat(101) }, { name: "Dashboard", channelId: "abc" }]) await f.chat("/sidebar/manage", { type: "add", channelId: "50", ...invalid }, 400)
    assert.deepEqual((await f.chat("/sidebar/manage", { type: "add", channelId: "50", name: "Dashboard" })).link, { channelId: "50", revision: 1, updatedAt: now })
    await f.chat("/sidebar/manage", { type: "add", channelId: "51", name: "Dashboard" }, 409)
    assert.equal((await f.chat("/sidebar/manage", { type: "set", name: "Settings" })).link.revision, 2)
    assert.equal(await f.revision("sidebar"), 2)
    clock += 1000
    const args = await f.dashboard()
    assert.equal((await f.apply(args, "sidebar", { type: "remove" })).job.state, "applied")
    assert.deepEqual(await f.post("/sidebar/get", { serverId: "10" }), { link: null })
    // A dashboard add records the channel the bot created and names
    await f.apply(args, "sidebar", { type: "add", name: "Dashboard", categoryId: null }, {}, 400)
    // A failure the bot can explain shows its fix
    const failed = await f.t.run(async ctx => (await ctx.db.query("dashboardConfigurationJobs").order("desc").first())!._id)
    await f.post("/dashboard-configuration/fail", { serverId: "10", jobId: failed, reason: "Grant Manage Channels to the NeonFlux role" })
    assert.equal(await f.t.run(async ctx => (await ctx.db.get(failed))!.error), "Grant Manage Channels to the NeonFlux role")
    assert.equal((await f.apply(args, "sidebar", { type: "add", name: "Dashboard", categoryId: null }, { context: { originServerId: "10", channelId: "52" } })).job.state, "applied")
    assert.equal((await f.post("/sidebar/get", { serverId: "10" })).link.channelId, "52")
    const overview = await f.t.query(api.dashboardViews.overview, args)
    assert.equal(overview.sections.find(section => section.id === "sidebar")?.state, "on")
})

test("Member-list changes are recorded for every manager, and only the owner or an Administrator can reset", async () => {
    const f = await fixture()
    assert.deepEqual(await f.chat("/memberlist/manage", { type: "set", roleIds: ["40", "41"] }), { revision: 1 })
    for (const invalid of [{ type: "set", roleIds: [] }, { type: "set", roleIds: ["40", "40"] }, { type: "set", roleIds: ["10"] }, { type: "shuffle" }]) await f.chat("/memberlist/manage", invalid, 400)
    await f.chat("/memberlist/manage", { type: "reset" }, 403)
    assert.deepEqual(await f.chat("/memberlist/manage", { type: "reset" }, 200, actor({ isAdministrator: true })), { revision: 2 })
    clock += 1000
    const args = await f.dashboard()
    const references = [{ id: "40", type: "role", serverId: "10", exists: true }, { id: "41", type: "role", serverId: "10", exists: true }]
    assert.equal((await f.apply(args, "memberlist", { type: "set", roleIds: ["41", "40"] }, { references })).job.state, "applied")
    assert.equal(await f.revision("memberlist"), 3)
    // A dashboard reset needs a fresh owner or Administrator read
    await f.apply(args, "memberlist", { type: "reset" }, {}, 403)
})
