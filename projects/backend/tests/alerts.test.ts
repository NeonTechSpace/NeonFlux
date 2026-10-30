import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { api } from "../convex/_generated/api.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"
import { cleanupAlertActions } from "../convex/alerts.ts"
import { metadataState } from "../convex/metadataLogsStore.ts"
import { RETENTION_PASSES } from "../convex/retention.ts"

const prior = { ...process.env },
    now = Date.parse("2026-01-01T00:00:00Z"),
    secret = "synthetic-alerts-test-secret-not-a-credential-000"
let clock = now
beforeEach(() => {
    clock = now
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = secret
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
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"])
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const modules = Object.fromEntries(
    [
        "alerts",
        "dashboard",
        "dashboardConfiguration",
        "dashboardViews",
        "metadataLogs",
        "botService",
        "_generated/api",
        "_generated/server",
    ].map((name) => [
        `../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`,
        () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`),
    ]),
)
const actor = {
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: false,
    isAdministrator: true,
    nativePermissionAuthorized: true,
}
const invite = {
    ref: "0123456789abcdef",
    channelId: "50",
    inviterId: "21",
    uses: 3,
    maxUses: 0,
    expiresAt: null,
    createdAt: "2025-12-31T00:00:00.000Z",
    temporary: false,
}

async function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, fields: Record<string, unknown> = {}) =>
        post(
            "/alerts/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: clock,
                actor,
                managerAuthorized: true,
                operation,
                ...fields,
            },
            expected,
        )
    return { t, post, manage }
}

test("Every alert starts off, chat changes need manager authority, and expected lists hold far more than 50 entries", async () => {
    const f = await fixture()
    assert.deepEqual(await f.post("/alerts/get", { serverId: "10" }), {
        settings: {
            invites: false,
            bots: false,
            webhooks: false,
            privileges: false,
            impersonation: false,
            kickBots: false,
            deleteWebhooks: false,
            removePermissions: false,
            expectedBotIds: [],
            expectedWebhookIds: [],
        },
    })
    // The contract allows only managerAuthorized true, so false is malformed. A member without Manage community is refused
    await f.manage({ type: "set", alert: "bots", enabled: true }, 400, { managerAuthorized: false })
    await f.manage({ type: "set", alert: "bots", enabled: true }, 403, {
        actor: { ...actor, nativePermissionAuthorized: false },
    })
    await f.manage({ type: "set", alert: "raids", enabled: true }, 400)
    // Invite reads and revocations are native work, so only dashboard jobs carry them
    await f.manage({ type: "invites-refresh" }, 400)
    assert.equal((await f.manage({ type: "set", alert: "bots", enabled: true })).settings.bots, true)
    await f.manage({ type: "expect", kind: "bot", ids: ["31"], expected: true })
    assert.deepEqual(
        (await f.manage({ type: "expect", kind: "bot", ids: ["31", "32"], expected: true })).settings.expectedBotIds,
        ["31", "32"],
    )
    assert.deepEqual(
        (await f.manage({ type: "expect", kind: "bot", ids: ["31", "32"], expected: false })).settings.expectedBotIds,
        [],
    )
    // Many IDs change in one chat operation, and a member without Manage community changes none of them
    const hooks = Array.from({ length: 60 }, (_, index) => String(100 + index))
    await f.manage({ type: "expect", kind: "webhook", ids: hooks, expected: true }, 403, {
        actor: { ...actor, nativePermissionAuthorized: false },
    })
    await f.manage({ type: "expect", kind: "webhook", ids: [], expected: true }, 400)
    await f.manage({ type: "expect", kind: "webhook", ids: hooks, expected: true })
    // The dashboard replaces the whole list in one job
    const d = await dashboard(f)
    const more = await d.queue({ type: "expected-set", kind: "webhook", ids: [...hooks, "160"] })
    assert.equal((await d.execute(more)).job.state, "applied")
    const expected = (await f.post("/alerts/get", { serverId: "10" })).settings.expectedWebhookIds
    assert.deepEqual(
        expected,
        Array.from({ length: 61 }, (_, index) => String(100 + index)),
    )
    // Each change moves the family revision once and reaches the audit log
    assert.equal(
        await f.t.run(async (ctx) => (await ctx.db.query("serverConfigurationRevisions").first())?.revision),
        6,
    )
    const audit = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.ok(audit.some((entry) => entry.feature === "alerts" && entry.summary.includes("bots: off → on")))
    assert.equal(audit.filter((entry) => entry.setting === "expected-set webhook").length, 1)
    // The last expected webhook is exempt from deletion, while an unexpected one may still be deleted
    clock += 1000
    await f.manage({ type: "set", alert: "webhooks", enabled: true })
    await f.manage({ type: "action", action: "deleteWebhooks", enabled: true })
    const deletion = (targetId: string) =>
        f.post("/alerts/claim-action", {
            serverId: "10",
            key: `audit:${targetId}`,
            action: "deleteWebhooks",
            targetId,
            actorId: "21",
        })
    assert.deepEqual(await deletion("160"), { claimed: false })
    assert.deepEqual(await deletion("161"), { claimed: true })
    // Many are removed at once, and an empty list clears it
    assert.deepEqual(
        (await f.manage({ type: "expect", kind: "webhook", ids: hooks.slice(1), expected: false })).settings
            .expectedWebhookIds,
        ["100", "160"],
    )
    const clear = await d.queue({ type: "expected-set", kind: "webhook", ids: [] })
    assert.equal((await d.execute(clear)).job.state, "applied")
    assert.deepEqual((await f.post("/alerts/get", { serverId: "10" })).settings.expectedWebhookIds, [])
    // Only Convex's 8,192 values in one array bound a list
    const full = Array.from({ length: 8192 }, (_, index) => String(10000 + index))
    await assert.rejects(d.queue({ type: "expected-set", kind: "webhook", ids: [...full, "200"] }))
    const whole = await d.queue({ type: "expected-set", kind: "webhook", ids: full })
    assert.equal((await d.execute(whole)).job.state, "applied")
    clock += 1000
    await f.manage({ type: "expect", kind: "webhook", ids: ["200", "201"], expected: true }, 429)
    assert.equal(
        (await f.manage({ type: "expect", kind: "webhook", ids: ["10000"], expected: false })).settings
            .expectedWebhookIds.length,
        8191,
    )
    assert.equal(
        (await f.manage({ type: "expect", kind: "webhook", ids: ["200", "10001"], expected: true })).settings
            .expectedWebhookIds.length,
        8192,
    )
})

async function dashboard(f: Awaited<ReturnType<typeof fixture>>) {
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-alerts-provider-token" }),
        args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = async () => {
        const view = await f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "alerts" })
        if (view.family !== "alerts") throw new Error("Wrong family")
        return view
    }
    let request = 0
    const queue = async (operation: DashboardConfigurationOperationMap["alerts"]) =>
        (
            await f.t.action(api.dashboardConfiguration.queue, {
                ...args,
                family: "alerts",
                operation,
                expectedConfigRevision: (await snapshot()).configRevision,
                requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`,
            })
        ).jobId
    const execute = (jobId: string | undefined, extra: Record<string, unknown> = {}, expected = 200) =>
        f.post(
            "/dashboard-configuration/execute",
            {
                serverId: "10",
                originServerId: "10",
                jobId,
                actorId: "20",
                managerAuthorized: true,
                observedAt: clock,
                actor,
                ...extra,
            },
            expected,
        )
    return { args, snapshot, queue, execute }
}

test("Dashboard invite jobs keep the invites the bot read with their codes, and other alert jobs carry no invite list", async () => {
    const f = await fixture()
    const { args, snapshot, queue, execute } = await dashboard(f)
    assert.equal((await snapshot()).data.invites, null)
    const refresh = await queue({ type: "invites-refresh" })
    // A code is kept for staff when it has Fluxer's usual form, and the list is bounded and checked
    const coded = { ...invite, code: "Synthetic-Code_1" }
    await execute(refresh, { context: { invites: [{ ...invite, code: "not a code" }], more: false } }, 400)
    await execute(refresh, { context: { invites: [invite, invite], more: false } }, 400)
    assert.equal((await execute(refresh, { context: { invites: [coded], more: true } })).job.state, "applied")
    assert.deepEqual((await snapshot()).data.invites, { readAt: clock, invites: [coded], more: true })
    // A later page keeps where it starts, so the dashboard can show and revoke older invites
    const older = await queue({ type: "invites-refresh", offset: 100 })
    assert.equal(
        (await execute(older, { context: { invites: [coded], offset: 100, more: false } })).job.state,
        "applied",
    )
    assert.deepEqual((await snapshot()).data.invites, { readAt: clock, invites: [coded], offset: 100, more: false })
    const revoke = await queue({ type: "invite-revoke", ref: invite.ref })
    assert.equal((await execute(revoke, { context: { invites: [], more: false } })).job.state, "applied")
    assert.deepEqual((await snapshot()).data.invites?.invites, [])
    const set = await queue({ type: "set", alert: "impersonation", enabled: true })
    await execute(set, { context: { invites: [], more: false } }, 400)
    assert.equal((await execute(set)).job.state, "applied")
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.impersonation, true)
    const overview = await f.t.query(api.dashboardViews.overview, args)
    assert.equal(overview.sections.find((section) => section.id === "alerts")?.state, "setup")
})

test("Turning an action on needs the owner or an Administrator, turning it off any manager, also at DEFCON 1", async () => {
    const f = await fixture()
    const manager = { ...actor, isAdministrator: false }
    await f.manage({ type: "action", action: "kickBots", enabled: true }, 403, { actor: manager })
    await f.manage({ type: "action", action: "raids", enabled: true }, 400)
    assert.equal((await f.manage({ type: "action", action: "kickBots", enabled: true })).settings.kickBots, true)
    assert.equal(
        (await f.manage({ type: "action", action: "kickBots", enabled: false }, 200, { actor: manager })).settings
            .kickBots,
        false,
    )
    // The dashboard asks the bot for a current owner or Administrator before it turns one on
    const d = await dashboard(f)
    const on = await d.queue({ type: "action", action: "deleteWebhooks", enabled: true })
    const ready = await f.post("/dashboard-configuration/ready", { serverId: "10" })
    assert.equal(ready.jobs[0].native.requiresOwnerAdmin, true)
    await d.execute(on, { actor: manager }, 403)
    assert.equal((await d.execute(on)).job.state, "applied")
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.deleteWebhooks, true)
    // DEFCON 1 lets staff turn an action off but not on
    await f.t.run((ctx) => insertDocument(ctx, "moderationSettings", "10"))
    const off = await d.queue({ type: "action", action: "deleteWebhooks", enabled: false })
    assert.equal((await d.execute(off)).job.state, "applied")
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.deleteWebhooks, false)
    const again = await d.queue({ type: "action", action: "kickBots", enabled: true })
    await d.execute(again, {}, 403)
    assert.equal((await f.post("/alerts/get", { serverId: "10" })).settings.kickBots, false)
})

test("Action claims dedupe by key and recheck the switches, outcomes record once, startup makes leftovers uncertain, and rows expire after a day", async () => {
    const f = await fixture()
    await f.t.run(async (ctx) => {
        const row = await metadataState(ctx, "10")
        await ctx.db.patch(row._id, { enabled: true })
    })
    const claim = (body: Record<string, unknown>) => f.post("/alerts/claim-action", { serverId: "10", ...body })
    const outcome = (key: string, value: string) =>
        f.post("/alerts/action-outcome", { serverId: "10", key, outcome: value })
    const kick = { key: "join:31:2026-01-01T00:00:00.000Z", action: "kickBots", targetId: "31" }
    const strip = {
        key: "audit:71",
        action: "removePermissions",
        targetId: "41",
        actorId: "21",
        permissions: ["Administrator"],
    }
    // Off until both the alert and its action are on
    assert.deepEqual(await claim(kick), { claimed: false })
    await f.manage({ type: "set", alert: "bots", enabled: true })
    assert.deepEqual(await claim(kick), { claimed: false })
    await f.manage({ type: "action", action: "kickBots", enabled: true })
    // A key for another bot, or a removal without its permissions, is malformed
    await f.post("/alerts/claim-action", { serverId: "10", ...kick, targetId: "32" }, 400)
    await f.post("/alerts/claim-action", { serverId: "10", ...strip, permissions: undefined }, 400)
    // An expected bot is never kicked, and a change an expected bot made is never undone
    await f.manage({ type: "expect", kind: "bot", ids: ["33"], expected: true })
    assert.deepEqual(await claim({ ...kick, key: "join:33:2026-01-01T00:00:00.000Z", targetId: "33" }), {
        claimed: false,
    })
    await f.manage({ type: "set", alert: "privileges", enabled: true })
    await f.manage({ type: "action", action: "removePermissions", enabled: true })
    assert.deepEqual(await claim({ ...strip, actorId: "33" }), { claimed: false })
    assert.deepEqual(await claim(kick), { claimed: true })
    assert.deepEqual(await claim(kick), { claimed: false })
    assert.deepEqual(await claim(strip), { claimed: true })
    assert.deepEqual(await outcome(kick.key, "succeeded"), { recorded: true, admitted: true })
    assert.deepEqual(await outcome(kick.key, "failed"), { recorded: false, admitted: false })
    assert.deepEqual(await outcome("audit:99", "failed"), { recorded: false, admitted: false })
    // The removal never got its outcome, so the next startup records it as uncertain, once
    assert.deepEqual(await f.post("/alerts/observe-actions", { serverId: "10" }), { uncertain: 1, admitted: true })
    assert.deepEqual(await f.post("/alerts/observe-actions", { serverId: "10" }), { uncertain: 0, admitted: false })
    assert.deepEqual(await outcome(strip.key, "succeeded"), { recorded: false, admitted: false })
    const records = await f.t.run(async (ctx) =>
        (await ctx.db.query("metadataLogRecords").collect())
            .filter((row) => row.event.type === "alert-action")
            .map((row) => [row.event.resourceIds, row.event.changedFields, row.event.actor.kind, row.event.count]),
    )
    assert.deepEqual(records, [
        [["31"], ["kick-bot", "succeeded"], "unknown", 1],
        [["41"], ["remove-permissions", "uncertain", "Administrator"], "unknown", 1],
    ])
    // Rows only stop redelivery, so retention deletes them after 24 hours
    assert.ok(RETENTION_PASSES.some(([name, pass]) => name === "alerts" && pass === cleanupAlertActions))
    const left = () => f.t.run(async (ctx) => (await ctx.db.query("alertActions").collect()).length)
    await f.t.run((ctx) => cleanupAlertActions(ctx, clock + 86400000 - 1))
    assert.equal(await left(), 2)
    await f.t.run((ctx) => cleanupAlertActions(ctx, clock + 86400000))
    assert.equal(await left(), 0)
})
