import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { PresetPlan } from "@neonflux/contracts/presets"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-preset-test-secret-not-a-credential-00"
beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] }); mock.method(Date, "now", () => now)
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
const modules = Object.fromEntries(["presets", "moderation", "leveling", "tickets", "events", "dashboard", "dashboardConfiguration", "metadataLogs", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const actor = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true }

function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const call = async (path: string, body: unknown, expected = 200): Promise<any> => {
        const response = await botCall(t, path, body), result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const plans = async (): Promise<PresetPlan[]> => (await call("/preset/plans", { serverId: "10" })).presets
    const plan = async (name: string) => (await plans()).find(row => row.name === name)!
    const apply = (name: string, token: string, expected = 200, who = actor) => call("/preset/apply", { serverId: "10", messageId: String(++sequence), createdAt: now, actor: who, name, token }, expected)
    const rules = () => t.run(async ctx => (await ctx.db.query("automodRules").collect()).map(row => row.rule).sort((a, b) => a.name.localeCompare(b.name)))
    const audit = () => t.run(async ctx => (await ctx.db.query("auditLogEntries").collect()).map(row => [row.feature, row.setting]))
    return { t, call, plans, plan, apply, rules, audit }
}

test("Every preset previews exactly the settings it would change, from the current values", async () => {
    const f = fixture()
    assert.deepEqual((await f.plans()).map(row => [row.name, row.kind]), [["gaming", "community"], ["support", "community"], ["creator", "community"], ["relaxed", "security"], ["balanced", "security"], ["strict", "security"]])
    assert.deepEqual((await f.plan("gaming")).changes, [
        { family: "leveling", setting: "leveling", from: "off", to: "on" }, { family: "leveling", setting: "XP per message", from: "15", to: "20" },
        { family: "events", setting: "events", from: "off", to: "on" }])
    // Leveling is already off on a new server, so support changes only tickets
    assert.deepEqual((await f.plan("support")).changes.map(change => `${change.setting}: ${change.from} → ${change.to}`), ["tickets: off → on", "ticket history days: 30 → 90"])
    assert.deepEqual((await f.plan("balanced")).changes.map(change => `${change.setting}: ${change.from} → ${change.to}`), [
        "automod: off → on", "automod mode: test mode → enforcing", "security: off → on", "security mode: test mode → enforcing", "join-burst detection: off → on", "join-burst window seconds: 10 → 30",
        "rule preset-spam: none → spam, delete at 6 in 10 seconds", "rule preset-repeat: none → repeat, delete at 4 in 30 seconds",
        "rule preset-mentions: none → mention-rate, delete at 15 in 30 seconds", "rule preset-lookalikes: none → deceptive-links, delete"])
    // Previewing changes nothing
    assert.equal((await f.rules()).length, 0)
    assert.deepEqual(await f.audit(), [])
})

test("Applying needs the owner or an Administrator and the confirmed preview, and records every family it changes", async () => {
    const f = fixture(), gaming = await f.plan("gaming")
    await f.apply("gaming", gaming.token, 403, { ...actor, isAdministrator: false })
    await f.apply("gaming", "00000000", 409)
    // The contract allows only the six preset names, so an unknown name is malformed
    await f.apply("unknown", gaming.token, 400)
    assert.deepEqual((await f.apply("gaming", gaming.token)).plan, gaming)
    const leveling = await f.t.run(ctx => ctx.db.query("levelingSettings").first()), events = await f.t.run(ctx => ctx.db.query("eventSettings").first())
    assert.deepEqual([leveling?.config.enabled, leveling?.config.xpPerMessage, leveling?.config.cooldownSeconds, events?.enabled], [true, 20, 60, true])
    assert.deepEqual(await f.audit(), [["leveling", "preset gaming"], ["events", "preset gaming"]])
    // A second application changes nothing, and an earlier confirmation no longer matches once settings changed
    assert.deepEqual((await f.plan("gaming")).changes, [])
    const creator = await f.plan("creator")
    assert.deepEqual(creator.changes.map(change => change.setting), ["XP per message", "XP cooldown seconds"])
    await f.call("/levels/manage", { serverId: "10", messageId: "1500", createdAt: now, actor, operation: { type: "settings", expectedRevision: leveling!.config.revision, patch: { xpPerMessage: 30 } } })
    await f.apply("creator", creator.token, 409)
})

test("Security levels add or update only their own rules and never delete or replace others", async () => {
    const f = fixture()
    // The manager's own rules, one of them under a preset rule name with another type
    const own = { enabled: true, priority: 5, action: "log", threshold: 3, windowSeconds: 10, durationSeconds: 60, patterns: ["bad"], domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: ["70"] }
    await f.call("/moderation/manage", { serverId: "10", messageId: "1600", createdAt: now, actor, operation: { type: "rule-create", rule: { ...own, name: "mine", type: "words" } } })
    await f.call("/moderation/manage", { serverId: "10", messageId: "1601", createdAt: now, actor, operation: { type: "rule-create", rule: { ...own, name: "preset-links", type: "words" } } })
    await f.apply("balanced", (await f.plan("balanced")).token)
    const strict = await f.plan("strict")
    assert.equal(strict.changes.some(change => change.setting === "rule preset-links"), false)
    assert.deepEqual(strict.changes.filter(change => change.setting.startsWith("rule ")).map(change => `${change.setting}: ${change.from} → ${change.to}`), [
        "rule preset-spam: spam, delete at 6 in 10 seconds → spam, timeout of 10 minutes at 5 in 10 seconds", "rule preset-repeat: repeat, delete at 4 in 30 seconds → repeat, delete at 3 in 30 seconds",
        "rule preset-mentions: mention-rate, delete at 15 in 30 seconds → mention-rate, timeout of 10 minutes at 10 in 30 seconds"])
    await f.apply("strict", strict.token)
    const rules = await f.rules()
    assert.deepEqual(rules.map(rule => [rule.name, rule.type, rule.action]), [["mine", "words", "log"], ["preset-links", "words", "log"], ["preset-lookalikes", "deceptive-links", "delete"],
        ["preset-mentions", "mention-rate", "timeout"], ["preset-repeat", "repeat", "delete"], ["preset-spam", "spam", "timeout"]])
    // A lower level keeps the rules a higher one added
    await f.apply("relaxed", (await f.plan("relaxed")).token)
    assert.equal((await f.rules()).length, 6)
    const settings = await f.t.run(ctx => ctx.db.query("moderationSettings").first())
    assert.deepEqual([settings?.config.joinEnabled, settings?.config.securityEnabled, settings?.config.automodBotMessagesEnabled], [false, true, false])
})

test("The dashboard applies a confirmed preset as one request and records each family on its own", async () => {
    const f = fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-preset-provider-token" }), args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = async () => { const view = await f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "presets" }); if (view.family !== "presets") throw new Error("Wrong family"); return view }
    const before = await snapshot(), support = before.data.presets.find(row => row.name === "support")!
    const job = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "presets", operation: { type: "apply", name: "support", token: support.token }, expectedConfigRevision: before.configRevision, requestId: "00000000-0000-4000-8000-000000000001" })
    const executed = await f.call("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor })
    assert.equal(executed.job.state, "applied")
    assert.deepEqual(await f.t.run(async ctx => (await ctx.db.query("auditLogEntries").collect()).map(row => [row.feature, row.setting, row.source])), [["tickets", "preset support", "website"]])
    const after = await snapshot()
    assert.equal(after.configRevision, before.configRevision + 1)
    assert.deepEqual(after.data.presets.find(row => row.name === "support")!.changes, [])
    // An Administrator is required, like in chat
    const again = await f.t.action(api.dashboardConfiguration.queue, { ...args, family: "presets", operation: { type: "apply", name: "gaming", token: after.data.presets[0]!.token }, expectedConfigRevision: after.configRevision, requestId: "00000000-0000-4000-8000-000000000002" })
    await f.call("/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: again.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor: { ...actor, isAdministrator: false } }, 403)
})
