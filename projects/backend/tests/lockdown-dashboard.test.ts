import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"

const prior = { ...process.env },
    now = Date.parse("2026-01-01T00:00:00Z")
const keys = ["NEONFLUX_SERVER_ID", "FLUXER_CLIENT_ID", "NEONFLUX_BOT_API_SECRET", "NEONFLUX_SERVER_MODE"]
beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-lockdown-dashboard-secret-not-a-credential"
    delete process.env.NEONFLUX_SERVER_MODE
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer")
            return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me"))
            return Response.json({
                application: { id: "30" },
                scopes: ["identify", "guilds"],
                user: { id: "20", username: "Manager", bot: false, system: false },
            })
        if (url.endsWith("/v1/users/@me/guilds?limit=100"))
            return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys)
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const manager = (overrides: object = {}) => ({
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: false,
    isAdministrator: false,
    nativePermissionAuthorized: true,
    ...overrides,
})
const admin = manager({ isAdministrator: true })
async function dashboard<F extends "lockdown" | "antinuke">(family: F) {
    const t = convexBackend(modules)
    const session = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }),
        args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = () => t.query(api.dashboardConfiguration.snapshot, { ...args, family })
    let request = 0
    const queue = async (operation: DashboardConfigurationOperationMap[F]) =>
        (
            await t.action(api.dashboardConfiguration.queue, {
                ...args,
                family,
                operation,
                expectedConfigRevision: (await snapshot()).configRevision,
                requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`,
            } as never)
        ).jobId
    const execute = async (jobId: string | undefined, extra: Record<string, unknown> = {}, expected = 200) => {
        const response = await botCall(t, "/dashboard-configuration/execute", {
            serverId: "10",
            originServerId: "10",
            jobId,
            actorId: "20",
            managerAuthorized: true,
            observedAt: now,
            actor: admin,
            ...extra,
        })
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result as { job: { state: string; failure?: string } }
    }
    return { t, snapshot, queue, execute }
}
const plan = [
    {
        channelId: "31",
        everyone: { exists: false, allow: "0", deny: "0" },
        bits: "2048",
        botBefore: { exists: false, allow: "0", deny: "0" },
    },
]

test("The website starts and lifts a lockdown with the plan the bot read, and saves the exempt list whole", async () => {
    const d = await dashboard("lockdown")
    const on = await d.queue({ type: "on", reason: "A raid" })
    // The bot's own read is required, and the plan is checked
    await d.execute(on, {}, 400)
    assert.equal((await d.execute(on, { context: { plan } })).job.state, "applied")
    const view = (await d.snapshot()).data as { lockdown: { state: string; origin: string; reason: string } }
    assert.deepEqual(
        [view.lockdown.state, view.lockdown.origin, view.lockdown.reason],
        ["locking", "dashboard", "A raid"],
    )
    const list = await d.queue({ type: "exempt-set", channelIds: ["31", "32", "31"] })
    assert.equal((await d.execute(list)).job.state, "applied")
    assert.deepEqual(
        ((await d.snapshot()).data as { settings: { exemptChannelIds: string[] } }).settings.exemptChannelIds,
        ["31", "32"],
    )
    const off = await d.queue({ type: "off" })
    assert.equal((await d.execute(off)).job.state, "applied")
    assert.equal(((await d.snapshot()).data as { lockdown: { state: string } }).lockdown.state, "ended")
    await d.t.run(async (ctx) => {
        const entries = await ctx.db.query("auditLogEntries").collect()
        assert.deepEqual(
            entries.map((entry) => [entry.feature, entry.setting.split(" ")[0]]),
            [
                ["lockdown", "on"],
                ["lockdown", "exempt-set"],
                ["lockdown", "off"],
            ],
        )
    })
})

test("A website lockdown that is refused fails its job with the reason, instead of showing as applied", async () => {
    const d = await dashboard("lockdown")
    const off = await d.queue({ type: "off" })
    const response = await botCall(d.t, "/dashboard-configuration/execute", {
        serverId: "10",
        originServerId: "10",
        jobId: off,
        actorId: "20",
        managerAuthorized: true,
        observedAt: now,
        actor: admin,
    })
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: "No lockdown is on", code: "REFUSED" })
})

test("A website settle reads through the bot and changes no setting", async () => {
    const d = await dashboard("antinuke")
    const settle = await d.queue({ type: "settle", incidentNo: 4 })
    assert.equal((await d.execute(settle)).job.state, "applied")
})

test("A manager who is not security staff cannot change a lockdown from the website", async () => {
    const d = await dashboard("lockdown")
    const on = await d.queue({ type: "on" })
    await d.execute(on, { actor: manager(), context: { plan } }, 403)
    assert.equal(((await d.snapshot()).data as { lockdown: unknown }).lockdown, null)
})

test("Every anti-nuke change on the website needs the owner or an Administrator, and a restore records what the bot did", async () => {
    const d = await dashboard("antinuke")
    const on = await d.queue({ type: "module", enabled: true })
    await d.execute(on, { actor: manager() }, 403)
    assert.equal((await d.execute(on)).job.state, "applied")
    const trust = await d.queue({ type: "trust-set", userIds: ["51", "51", "52"] })
    assert.equal((await d.execute(trust)).job.state, "applied")
    const settings = ((await d.snapshot()).data as { settings: { enabled: boolean; trustedIds: string[] } }).settings
    assert.deepEqual([settings.enabled, settings.trustedIds], [true, ["51", "52"]])
})

test("A website restore needs what the bot did, for an incident of that member, and other anti-nuke changes carry no native context", async () => {
    const d = await dashboard("antinuke")
    const restore = await d.queue({ type: "restore", incidentNo: 9 })
    await d.execute(restore, {}, 400)
    await d.execute(restore, { context: { result: { incidentNo: 9, outcome: "succeeded" } } }, 404)
    const other = await dashboard("antinuke")
    const mode = await other.queue({ type: "mode", mode: "enforce" })
    await other.execute(mode, { context: { result: { incidentNo: 9, outcome: "succeeded" } } }, 400)
    assert.equal((await other.execute(mode)).job.state, "applied")
})

test("Every website manager sees only how many incidents there are, and the list needs the private access check", async () => {
    const d = await dashboard("antinuke")
    await d.t.run(async (ctx) => {
        await insertDocument(ctx, "antiNukeSettings", "10", { enabled: true, nextIncidentNo: 3, trustedIds: ["51"] })
        await insertDocument(ctx, "antiNukeIncidents", "10", { incidentNo: 1, actorId: "777", outcome: "uncertain" })
        await insertDocument(ctx, "antiNukeIncidents", "10", { incidentNo: 2, actorId: "778", outcome: "succeeded" })
    })
    const data = (await d.snapshot()).data as { incidentCount: number; unconfirmedCount: number }
    assert.deepEqual([data.incidentCount, data.unconfirmedCount], [2, 1])
    assert.doesNotMatch(JSON.stringify(data), /777|778/)
    // Trusted accounts are a setting, so they stay
    assert.match(JSON.stringify(data), /51/)
    const session = await d.t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }),
        args = { sessionToken: session.sessionToken, serverId: "10", view: { type: "incidents" as const } }
    assert.deepEqual(await d.t.mutation(api.privateData.view, args), { status: "checking" })
    await botCall(d.t, "/private-data/record", {
        serverId: "10",
        userId: "20",
        originServerId: "10",
        isOwner: false,
        present: true,
        roleIds: [],
    })
    assert.deepEqual(await d.t.mutation(api.privateData.view, args), { status: "refused" })
    assert.deepEqual(
        await d.t.run(async (ctx) => {
            const row = await ctx.db.query("dashboardPrivateAccessJobs").first()
            await ctx.db.patch(row!._id, { state: "passed", checkedAt: now, owner: true })
            return row!.userId
        }),
        "20",
    )
    const shown = await d.t.mutation(api.privateData.view, args)
    assert.equal(shown.status, "ok")
    const list = shown.status === "ok" && shown.data.type === "incidents" ? shown.data.incidents : []
    assert.deepEqual(
        list.map((row) => [row.incidentNo, row.actorId]),
        [
            [2, "778"],
            [1, "777"],
        ],
    )
    await d.t.run(async (ctx) => {
        const entries = await ctx.db.query("auditLogEntries").collect()
        assert.deepEqual(
            entries.map((entry) => [entry.kind, entry.setting]),
            [["private-data-viewed", "Anti-nuke incidents"]],
        )
    })
})
