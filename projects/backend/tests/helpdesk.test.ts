import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-helpdesk-test-secret-not-a-credential"
const hour = 3600000
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
const modules = Object.fromEntries(["helpDesk", "dashboard", "dashboardConfiguration", "dashboardViews", "metadataLogs", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, authorized = "manager") => post("/helpdesk/manage", { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor, authorized, operation }, expected)
    const settings = async () => (await post("/helpdesk/get", { serverId: "10" })).settings
    const work = () => post("/helpdesk/work", { serverId: "10" })
    const opened = (threadId: string, forumId = "50") => post("/helpdesk/opened", { serverId: "10", threadId, forumId })
    const revision = () => t.run(async ctx => (await ctx.db.query("serverConfigurationRevisions").first())?.revision ?? 0)
    return { t, post, manage, settings, work, opened, revision }
}

test("Settings need a manager, answers accept staff, and both stay within their limits", async () => {
    const f = await fixture()
    assert.deepEqual(await f.settings(), { forumIds: [], greeting: "Thanks for posting. Members and staff reply in this post. Send !solved once your question is answered", solvedTag: "Solved", nudgeHours: 24, guardChannelId: null, autoArchive: false, revision: 0 })
    await f.manage({ type: "forum-add", channelId: "50" }, 403, "staff")
    assert.deepEqual((await f.manage({ type: "forum-add", channelId: "50" })).settings.forumIds, ["50"])
    await f.manage({ type: "forum-add", channelId: "50" }, 409)
    for (let id = 51; id < 60; id++) await f.manage({ type: "forum-add", channelId: String(id) })
    await f.manage({ type: "forum-add", channelId: "60" }, 429)
    await f.manage({ type: "forum-remove", channelId: "60" }, 404)
    for (const invalid of [{ solvedTag: "x".repeat(51) }, { solvedTag: " " }, { greeting: "x".repeat(501) }, { nudgeHours: 0 }, { nudgeHours: 169 }, { autoArchive: "yes" }, {}]) await f.manage({ type: "settings", ...invalid }, 400)
    const changed = (await f.manage({ type: "settings", solvedTag: " Answered ", greeting: null, nudgeHours: null })).settings
    assert.deepEqual([changed.solvedTag, changed.greeting, changed.nudgeHours, changed.revision], ["Answered", null, null, 11])

    assert.deepEqual((await f.manage({ type: "answer-set", name: "logs", title: "Send your logs", content: "Open settings and copy the log" }, 200, "staff")).answer,
        { name: "logs", title: "Send your logs", content: "Open settings and copy the log", updatedAt: now })
    for (const name of ["Logs", "list", "x".repeat(33), "-a"]) await f.manage({ type: "answer-set", name, title: "Title", content: "Text" }, 400, "staff")
    await f.manage({ type: "answer-set", name: "long", title: "Title", content: "x".repeat(2001) }, 400, "staff")
    for (let index = 1; index < 50; index++) await f.manage({ type: "answer-set", name: `a${index}`, title: "Title", content: "Text" }, 200, "staff")
    await f.manage({ type: "answer-set", name: "one-more", title: "Title", content: "Text" }, 429, "staff")
    // Replacing an existing answer still works at the limit
    assert.equal((await f.manage({ type: "answer-set", name: "logs", title: "New title", content: "Text" }, 200, "staff")).answer.title, "New title")
    assert.deepEqual((await f.post("/helpdesk/answers", { serverId: "10", name: "logs" })).answers.map((a: { title: string }) => a.title), ["New title"])
    assert.deepEqual((await f.post("/helpdesk/answers", { serverId: "10", name: "missing" })).answers, [])
    assert.equal((await f.post("/helpdesk/answers", { serverId: "10" })).answers.length, 50)
    await f.manage({ type: "answer-remove", name: "logs" }, 200, "staff")
    await f.manage({ type: "answer-remove", name: "logs" }, 404, "staff")
    // Every saved change moves the family revision, which the settings history follows
    assert.equal(await f.revision(), 11 + 1 + 49 + 1 + 1)
})

test("A new post gets one reply reminder after the wait, and only while its forum uses the help desk", async () => {
    const f = await fixture()
    // Without the forum in the help desk, nothing is recorded
    assert.deepEqual(await f.opened("700"), { recorded: false })
    await f.manage({ type: "forum-add", channelId: "50" })
    await f.manage({ type: "forum-add", channelId: "51" })
    assert.deepEqual(await f.opened("700"), { recorded: true })
    assert.deepEqual(await f.opened("700"), { recorded: false })
    await f.opened("701", "51")
    assert.deepEqual(await f.work(), { nudges: [], more: false, guard: null })
    clock += 24 * hour
    await f.manage({ type: "forum-remove", channelId: "51" })
    // The reminder of a forum that left the help desk is dropped unsent, and each reminder is claimed once
    assert.deepEqual(await f.work(), { nudges: [{ threadId: "700", forumId: "50" }], more: false, guard: null })
    assert.deepEqual(await f.work(), { nudges: [], more: false, guard: null })
    // A pass claims at most 25 reminders and says when more are due
    for (let id = 800; id < 830; id++) await f.opened(String(id))
    clock += 24 * hour
    const first = await f.work()
    assert.deepEqual([first.nudges.length, first.more], [25, true])
    const second = await f.work()
    assert.deepEqual([second.nudges.length, second.more], [5, false])
    // Turning reminders off records no new posts
    await f.manage({ type: "settings", nudgeHours: null })
    assert.deepEqual(await f.opened("900"), { recorded: false })
})

test("The thread budget guard runs hourly while on, sooner while changes remain, and warns at most once a day", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", guardChannelId: "60" })
    const pass = { channelId: "60", autoArchive: false, threshold: 900 }
    assert.deepEqual((await f.work()).guard, pass)
    assert.equal((await f.work()).guard, null)
    // A pass near the cap warns once, and a later one the same day does not
    assert.deepEqual(await f.post("/helpdesk/guard", { serverId: "10", activeThreads: 950, more: false }), { warn: true })
    assert.deepEqual(await f.post("/helpdesk/guard", { serverId: "10", activeThreads: 990, more: false }), { warn: false })
    clock += hour
    assert.deepEqual((await f.work()).guard, pass)
    // Changes left for later bring the next pass ten minutes closer
    assert.deepEqual(await f.post("/helpdesk/guard", { serverId: "10", activeThreads: 10, more: true }), { warn: false })
    clock += 10 * 60000
    assert.deepEqual((await f.work()).guard, pass)
    clock += 24 * hour
    assert.deepEqual((await f.work()).guard, pass)
    assert.deepEqual(await f.post("/helpdesk/guard", { serverId: "10", activeThreads: 900, more: false }), { warn: true })
    // Auto-archive alone keeps the guard on without warnings, and turning both off stops it
    await f.manage({ type: "settings", guardChannelId: null, autoArchive: true })
    clock += hour
    assert.deepEqual((await f.work()).guard, { channelId: null, autoArchive: true, threshold: 900 })
    await f.manage({ type: "settings", autoArchive: false })
    clock += hour
    assert.equal((await f.work()).guard, null)
    assert.deepEqual(await f.post("/helpdesk/guard", { serverId: "10", activeThreads: 999, more: true }), { warn: false })
})

test("Dashboard help desk changes store the same settings as chat commands and show in the overview", async () => {
    const f = await fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-helpdesk-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = () => f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "helpdesk" })
    let request = 0
    const apply = async (operation: DashboardConfigurationOperationMap["helpdesk"], extra: Record<string, unknown> = {}) => {
        const job = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "helpdesk", operation, expectedConfigRevision: (await snapshot()).configRevision, requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}` })
        return f.post("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor, ...extra })
    }
    const overview = async () => (await f.t.query(api.dashboardViews.overview, args)).sections.find(section => section.id === "helpdesk")?.state
    assert.equal(await overview(), "off")
    // The bot proves the forum exists in the server before the change applies
    assert.equal((await apply({ type: "forum-add", channelId: "50" }, { references: [{ id: "50", type: "channel", serverId: "10", exists: true }] })).job.state, "applied")
    clock += 1000
    assert.equal((await apply({ type: "answer-set", name: "logs", title: "Logs", content: "Send logs" })).job.state, "applied")
    const view = await snapshot()
    if (view.family !== "helpdesk") throw new Error("Wrong family")
    assert.deepEqual([view.data.settings.forumIds, view.data.answers.map(answer => answer.name)], [["50"], ["logs"]])
    assert.equal(await overview(), "on")
})
