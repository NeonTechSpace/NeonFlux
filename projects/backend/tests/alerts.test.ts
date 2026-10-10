import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-alerts-test-secret-not-a-credential-000"
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
const modules = Object.fromEntries(["alerts", "dashboard", "dashboardConfiguration", "dashboardViews", "metadataLogs", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true }
const invite = { ref: "0123456789abcdef", channelId: "50", inviterId: "21", uses: 3, maxUses: 0, expiresAt: null, createdAt: "2025-12-31T00:00:00.000Z", temporary: false }

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, fields: Record<string, unknown> = {}) => post("/alerts/manage", { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor, managerAuthorized: true, operation, ...fields }, expected)
    return { t, post, manage }
}

test("Every alert starts off, and chat changes need manager authority and keep at most 50 expected bots", async () => {
    const f = await fixture()
    assert.deepEqual(await f.post("/alerts/get", { serverId: "10" }), { settings: { invites: false, bots: false, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [] } })
    // The contract allows only managerAuthorized true, so false is malformed. A member without Manage Server is refused
    await f.manage({ type: "set", alert: "bots", enabled: true }, 400, { managerAuthorized: false })
    await f.manage({ type: "set", alert: "bots", enabled: true }, 403, { actor: { ...actor, nativePermissionAuthorized: false } })
    await f.manage({ type: "set", alert: "raids", enabled: true }, 400)
    // Invite reads and revocations are native work, so only dashboard jobs carry them
    await f.manage({ type: "invites-refresh" }, 400)
    assert.equal((await f.manage({ type: "set", alert: "bots", enabled: true })).settings.bots, true)
    await f.manage({ type: "expect", kind: "bot", id: "31", expected: true })
    assert.deepEqual((await f.manage({ type: "expect", kind: "bot", id: "31", expected: true })).settings.expectedBotIds, ["31"])
    assert.deepEqual((await f.manage({ type: "expect", kind: "bot", id: "31", expected: false })).settings.expectedBotIds, [])
    for (let index = 0; index < 50; index++) await f.manage({ type: "expect", kind: "webhook", id: String(100 + index), expected: true })
    await f.manage({ type: "expect", kind: "webhook", id: "200", expected: true }, 429)
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.expectedWebhookIds.length, 50)
    // Each change moves the family revision and reaches the audit log
    assert.equal(await f.t.run(async ctx => (await ctx.db.query("serverConfigurationRevisions").first())?.revision), 54)
    const audit = await f.t.run(ctx => ctx.db.query("auditLogEntries").collect())
    assert.ok(audit.some(entry => entry.feature === "alerts" && entry.summary.includes("bots: off → on")))
})

test("Dashboard invite jobs keep the invites the bot read without codes, and other alert jobs carry no invite list", async () => {
    const f = await fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-alerts-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = async () => { const view = await f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "alerts" }); if (view.family !== "alerts") throw new Error("Wrong family"); return view }
    let request = 0
    const queue = async (operation: DashboardConfigurationOperationMap["alerts"]) => (await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "alerts", operation,
        expectedConfigRevision: (await snapshot()).configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` })).jobId
    const execute = (jobId: string | undefined, extra: Record<string, unknown> = {}, expected = 200) => f.post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId, actorId: "20", managerAuthorized: true, observedAt: clock, actor, ...extra }, expected)
    assert.equal((await snapshot()).data.invites, null)
    const refresh = await queue({ type: "invites-refresh" })
    // A code never reaches the backend, and the list is bounded and checked
    await execute(refresh, { context: { invites: [{ ...invite, code: "synthetic-code" }], more: false } }, 400)
    await execute(refresh, { context: { invites: [invite, invite], more: false } }, 400)
    assert.equal((await execute(refresh, { context: { invites: [invite], more: true } })).job.state, "applied")
    assert.deepEqual((await snapshot()).data.invites, { readAt: clock, invites: [invite], more: true })
    const revoke = await queue({ type: "invite-revoke", ref: invite.ref })
    assert.equal((await execute(revoke, { context: { invites: [], more: false } })).job.state, "applied")
    assert.deepEqual((await snapshot()).data.invites?.invites, [])
    const set = await queue({ type: "set", alert: "impersonation", enabled: true })
    await execute(set, { context: { invites: [], more: false } }, 400)
    assert.equal((await execute(set)).job.state, "applied")
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.impersonation, true)
    const overview = await f.t.query(api.dashboardViews.overview, args)
    assert.equal(overview.sections.find(section => section.id === "alerts")?.state, "setup")
})
