import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { DashboardAuditPage } from "../dashboard-contracts.js"
import { AUDIT_RETENTION_MS, describeChange, operationLabel, recordAudit } from "../convex/auditLog.ts"
import { RETENTION_PASSES } from "../convex/retention.ts"
import { backupImports } from "../convex/backupImports.ts"
import { botCall } from "./bot-service.ts"

const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-audit-log-secret-00000000000000000000"
    now = start
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Manager", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
})

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const manager = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }), session = await t.action(api.dashboard.admit, { accessToken: "synthetic-audit-provider-token" })
    const args = { sessionToken: session.sessionToken, serverId: "10" }
    const page = (extra: { feature?: string, cursor?: string | null } = {}): Promise<DashboardAuditPage> => t.query(api.auditLog.page, { ...args, cursor: null, ...extra })
    return { t, args, page }
}

test("Website and command setting changes record who changed what, newest first, without authored text", async () => {
    const { t, args, page } = await fixture()
    const job = await t.action(api.dashboardConfiguration.queue, { ...args, family: "leveling", operation: { type: "settings", expectedRevision: 1, patch: { xpPerMessage: 25 } }, expectedConfigRevision: 0, requestId: "00000000-0000-4000-8000-000000000001" })
    const executed = await botCall(t, "/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor: manager })
    assert.equal(executed.status, 200)
    const create = { serverId: "10", messageId: "1000", createdAt: now, actorId: "99", adminAuthorized: true, kind: "custom", operation: { type: "create", name: "rules", reply: { type: "text", text: "Synthetic authored reply" } } }
    await t.mutation(internal.responses.manage, { request: create })
    // A redelivered command changes nothing and records nothing
    assert.deepEqual(await t.mutation(internal.responses.manage, { request: create }), { duplicate: true })
    await t.mutation(internal.generalSettings.manage, { request: { serverId: "10", actorId: "99", managerAuthorized: true, expectedRevision: 0, prefix: "?" } })
    assert.deepEqual(await t.action(api.dashboard.save, { ...args, section: "general", expectedRevision: 1, prefix: "$" }), { saved: true, revision: 2 })
    await t.mutation(internal.analytics.manage, { request: { serverId: "10", actorId: "99", managerAuthorized: true, enabled: false } })

    const entries = (await page()).entries.map(({ source, actorId, actorName, feature, setting, summary, kind }) => ({ source, actorId, actorName, feature, setting, summary, kind }))
    assert.deepEqual(entries, [
        { source: "command", actorId: "99", actorName: undefined, feature: "analytics", setting: "switch", summary: "enabled: on → off", kind: "setting" },
        { source: "website", actorId: "20", actorName: "Manager", feature: "prefix", setting: "prefix", summary: "prefix: ? → $", kind: "setting" },
        { source: "command", actorId: "99", actorName: undefined, feature: "prefix", setting: "prefix", summary: "prefix: ! → ?", kind: "setting" },
        { source: "command", actorId: "99", actorName: undefined, feature: "responses", setting: "create rules", summary: "definitions: added rules", kind: "setting" },
        { source: "website", actorId: "20", actorName: "Manager", feature: "leveling", setting: "settings", summary: "xpPerMessage: 15 → 25", kind: "setting" },
    ])
    assert.deepEqual((await page({ feature: "prefix" })).entries.map(entry => entry.source), ["website", "command"])
    assert.ok(!JSON.stringify(entries).includes("Synthetic authored reply"))
})

test("Logging, role settings and a backup restore record through their shared write paths", async () => {
    const { t, page } = await fixture()
    const owner = { originServerId: "10", userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const member = (userId: string, isBot = false) => ({ originServerId: "10", userId, joinedAt: "2020-01-01T00:00:00Z", roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
    const context = { originServerId: "10", observedAt: now, actor: owner, member: member("99"), botMember: member("999", true), channelId: "50", channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    await t.mutation(internal.metadataLogs.manage, { request: { serverId: "10", messageId: "100", createdAt: now, context, operation: { type: "module", expectedRevision: 1, enabled: true } } })
    await t.mutation(internal.roles.manage, { request: { serverId: "10", messageId: "101", createdAt: now, actor: owner, operation: { type: "settings", patch: { verificationEnabled: true } } } })
    await t.run(ctx => backupImports.backupImportConfig(ctx, "10", { family: "response", sourceId: "custom_restored", value: { kind: "custom", name: "restored", reply: { type: "text", text: "Restored" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true } }, "99"))
    assert.deepEqual((await page()).entries.map(({ feature, setting, summary, actorId }) => ({ feature, setting, summary, actorId })), [
        { feature: "responses", setting: "restore response", summary: "Imported custom_restored from a backup", actorId: "99" },
        { feature: "roles", setting: "settings", summary: "verificationEnabled: off → on", actorId: "99" },
        { feature: "logs", setting: "module", summary: "enabled: off → on", actorId: "99" },
    ])
})

test("Pages hold 25 entries and continue with a cursor, and only server managers read them", async () => {
    const { t, args, page } = await fixture()
    await t.run(async ctx => { for (let index = 0; index < 30; index++) await recordAudit(ctx, "10", { userId: "20", source: "command" }, { kind: "setting", feature: "voice", setting: `change ${index}`, summary: "Saved" }) })
    await t.run(ctx => recordAudit(ctx, "10", { userId: "20", name: "Manager", source: "website" }, { kind: "private-data-viewed", feature: "moderation", setting: "case 4", summary: "Viewed a private case" }))
    const first = await page()
    assert.equal(first.entries.length, 25)
    assert.deepEqual([first.entries[0]!.kind, first.entries[1]!.setting], ["private-data-viewed", "change 29"])
    assert.ok(first.nextCursor)
    const second = await page({ cursor: first.nextCursor })
    assert.deepEqual([second.entries.length, second.entries.at(-1)!.setting, second.nextCursor], [6, "change 0", null])
    await assert.rejects(t.query(api.auditLog.page, { ...args, serverId: "11", cursor: null }))
})

test("The retention chain removes entries after 180 days", async () => {
    const { t } = await fixture()
    assert.ok(RETENTION_PASSES.some(([name]) => name === "auditLog"))
    await t.run(ctx => recordAudit(ctx, "10", { userId: "20", source: "command" }, { kind: "setting", feature: "voice", setting: "old", summary: "Saved" }))
    now += AUDIT_RETENTION_MS - 1
    await t.run(ctx => recordAudit(ctx, "10", { userId: "20", source: "command" }, { kind: "setting", feature: "voice", setting: "new", summary: "Saved" }))
    await t.mutation(internal.retention.run, {})
    assert.equal((await t.run(ctx => ctx.db.query("auditLogEntries").collect())).length, 2)
    now += 1
    await t.mutation(internal.retention.run, {})
    assert.deepEqual((await t.run(ctx => ctx.db.query("auditLogEntries").collect())).map(row => row.setting), ["new"])
})

test("Change summaries name settings and list items but never show authored text", () => {
    assert.equal(describeChange({ settings: { enabled: false, cooldown: 60, revision: 3 } }, { settings: { enabled: true, cooldown: 60, revision: 4 } }), "enabled: off → on")
    assert.equal(describeChange({ settings: { description: "Old private words" } }, { settings: { description: "New private words" } }), "description changed")
    assert.equal(describeChange({ rules: [{ name: "spam", threshold: 3 }, { name: "links" }] }, { rules: [{ name: "spam", threshold: 5 }, { name: "caps" }] }), "rules: added caps; rules: removed links; rules: changed spam")
    assert.equal(describeChange({ words: ["a"] }, { words: ["a", "b"] }), "words: 1 → 2 items")
    assert.equal(describeChange({ settings: { enabled: true } }, { settings: { enabled: true } }), "Saved")
    assert.equal(describeChange({ settings: null, nickname: null }, { settings: { enabled: true }, nickname: "Bot" }), "enabled: none → on; nickname: none → Bot")
    assert.equal(operationLabel({ kind: "custom", operation: { type: "definition-create", definition: { name: "hello" } } }), "definition-create hello")
    assert.equal(operationLabel({ type: "settings", patch: { enabled: false } }), "settings")
})
