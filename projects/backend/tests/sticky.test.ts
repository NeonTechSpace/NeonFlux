import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-sticky-test-secret-not-a-credential-00"
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
const modules = Object.fromEntries(["sticky", "dashboard", "dashboardConfiguration", "dashboardViews", "metadataLogs", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true }

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, fields: Record<string, unknown> = {}) => post("/sticky/manage", { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor, managerAuthorized: true, operation, ...fields }, expected)
    const posted = (fields: Record<string, unknown>) => post("/sticky/posted", { serverId: "10", channelId: "50", revision: 1, previousMessageId: null, messageId: "700", ...fields })
    const revision = () => t.run(async ctx => (await ctx.db.query("serverConfigurationRevisions").first())?.revision ?? 0)
    return { t, post, manage, posted, revision }
}

test("Chat changes need manager authority, validate text and interval and keep at most five stickies", async () => {
    const f = await fixture()
    await f.manage({ type: "set", channelId: "50", content: "Rules" }, 403, { managerAuthorized: false })
    await f.manage({ type: "set", channelId: "50", intervalSeconds: 60 }, 404)
    for (const invalid of [{ content: "" }, { content: "x".repeat(2001) }, { content: "Rules", intervalSeconds: 9 }, { content: "Rules", intervalSeconds: 3601 }]) await f.manage({ type: "set", channelId: "50", ...invalid }, 400)
    const created = (await f.manage({ type: "set", channelId: "50", content: "Rules" })).sticky
    assert.deepEqual(created, { channelId: "50", content: "Rules", intervalSeconds: 30, messageId: null, revision: 1, updatedAt: now })
    const changed = (await f.manage({ type: "set", channelId: "50", intervalSeconds: 120 })).sticky
    assert.deepEqual([changed.content, changed.intervalSeconds, changed.revision], ["Rules", 120, 2])
    for (let index = 1; index < 5; index++) await f.manage({ type: "set", channelId: String(50 + index), content: "More" })
    await f.manage({ type: "set", channelId: "60", content: "Too many" }, 429)
    assert.equal((await f.post("/sticky/list", { serverId: "10" })).stickies.length, 5)
    // Every saved change moves the shared configuration revision, which the settings history follows
    assert.equal(await f.revision(), 6)
    const removed = await f.manage({ type: "remove", channelId: "50" })
    assert.equal(removed.type, "removed"); assert.equal(removed.sticky.channelId, "50")
    await f.manage({ type: "remove", channelId: "50" }, 404)
})

test("Of two racing reposts only the first copy is recorded, and a text change makes an older repost lose", async () => {
    const f = await fixture()
    await f.manage({ type: "set", channelId: "50", content: "Rules" })
    assert.deepEqual(await f.posted({ messageId: "700" }), { accepted: true, sticky: { channelId: "50", content: "Rules", intervalSeconds: 30, messageId: "700", revision: 1, updatedAt: now } })
    // The second repost still names no previous copy, so it loses and learns the recorded one
    const lost = await f.posted({ messageId: "701" })
    assert.equal(lost.accepted, false); assert.equal(lost.sticky.messageId, "700")
    await f.manage({ type: "set", channelId: "50", content: "New rules" })
    assert.equal((await f.posted({ previousMessageId: "700", messageId: "702" })).accepted, false)
    assert.equal((await f.posted({ revision: 2, previousMessageId: "700", messageId: "702" })).accepted, true)
    await f.manage({ type: "remove", channelId: "50" })
    assert.deepEqual(await f.posted({ revision: 2, previousMessageId: "702", messageId: "703" }), { accepted: false, sticky: null })
})

test("Dashboard sticky changes store the same settings as chat commands", async () => {
    const f = await fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-sticky-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = () => f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "sticky" })
    let request = 0
    const apply = async (operation: DashboardConfigurationOperationMap["sticky"], extra: Record<string, unknown> = {}) => {
        const job = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "sticky", operation, expectedConfigRevision: (await snapshot()).configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` })
        return f.post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor, ...extra })
    }
    const references = [{ id: "50", type: "channel", serverId: "10", exists: true }]
    // The bot proves the channel exists in the server before the change applies
    assert.equal((await apply({ type: "set", channelId: "50", content: "Rules", intervalSeconds: 45 }, { references })).job.state, "applied")
    clock += 1000
    const view = await snapshot()
    if (view.family !== "sticky") throw new Error("Wrong family")
    assert.deepEqual(view.data.stickies.map(sticky => [sticky.channelId, sticky.content, sticky.intervalSeconds]), [["50", "Rules", 45]])
    assert.equal((await apply({ type: "remove", channelId: "50" })).job.state, "applied")
    const removed = await snapshot()
    if (removed.family !== "sticky") throw new Error("Wrong family")
    assert.deepEqual(removed.data.stickies, [])
    const overview = await f.t.query(api.dashboardViews.overview, args)
    assert.equal(overview.sections.find(section => section.id === "sticky")?.state, "off")
})
