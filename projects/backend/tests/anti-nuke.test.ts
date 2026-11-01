import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import type { AntiNukeIncidentsResult, AntiNukeOpenResult, AntiNukeResult } from "@neonflux/contracts/anti-nuke"
import { ANTI_NUKE_DEFAULT_LIMITS, defaultAntiNukeSettings } from "@neonflux/contracts/anti-nuke"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { readRecoveryInbox } from "../convex/recovery.ts"
import { readSetupSections } from "../convex/setupCheck.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z")
let clock = start
beforeEach(() => {
    clock = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-anti-nuke-test-secret-not-a-credential"
    delete process.env.NEONFLUX_SERVER_MODE
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"])
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
const actor = (overrides: object = {}) => ({
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: false,
    isAdministrator: true,
    nativePermissionAuthorized: true,
    ...overrides,
})
const incident = (fields: object = {}) => ({
    serverId: "10",
    actorId: "50",
    actorKind: "staff",
    rule: "bans",
    counts: { ban: 12 },
    firstAt: clock - 5000,
    lastAt: clock,
    response: "strip",
    removedRoleIds: ["70", "71"],
    ...fields,
})
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async <T>(path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result as T
    }
    const manage = (operation: unknown, who: object = actor(), expected = 200) =>
        post<AntiNukeResult>(
            "/antinuke/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: clock,
                actor: who,
                operation,
            },
            expected,
        )
    const open = (fields: object = {}) => post<AntiNukeOpenResult>("/antinuke/open", incident(fields))
    const finish = (incidentNo: number, outcome: string, fields: object = {}) =>
        post<{ recorded: boolean; admitted: boolean }>("/antinuke/finish", {
            serverId: "10",
            incidentNo,
            outcome,
            ...fields,
        })
    const list = (query: object, who: object = actor(), expected = 200) =>
        post<AntiNukeIncidentsResult>("/antinuke/incidents", { serverId: "10", actor: who, query }, expected)
    return { t, post, manage, open, finish, list }
}

test("Every setting starts off, only the owner or an Administrator changes one, and limits stay within their bounds", async () => {
    const f = fixture()
    assert.deepEqual(await f.post("/antinuke/get", { serverId: "10" }), { settings: defaultAntiNukeSettings() })
    await f.manage({ type: "module", enabled: true }, actor({ isAdministrator: false }), 403)
    assert.equal((await f.manage({ type: "module", enabled: true })).settings.enabled, true)
    assert.equal((await f.manage({ type: "mode", mode: "enforce" })).settings.mode, "enforce")
    assert.equal((await f.manage({ type: "response", response: "ban" })).settings.response, "ban")
    assert.equal((await f.manage({ type: "lockdown", enabled: true })).settings.lockdown, true)
    assert.deepEqual(
        (await f.manage({ type: "limit", limit: "roles", value: { count: 3, seconds: 20 } })).settings.limits,
        { ...ANTI_NUKE_DEFAULT_LIMITS, roles: { count: 3, seconds: 20 } },
    )
    await f.manage({ type: "limit", limit: "roles", value: { count: 1, seconds: 20 } }, actor(), 400)
    await f.manage({ type: "limit", limit: "roles", value: { count: 3, seconds: 99999 } }, actor(), 400)
    assert.deepEqual((await f.manage({ type: "trust", userId: "51", trusted: true })).settings.trustedIds, ["51"])
    assert.deepEqual((await f.manage({ type: "trust", userId: "51", trusted: false })).settings.trustedIds, [])
    await f.t.run(async (ctx) => {
        const entries = await ctx.db.query("auditLogEntries").collect()
        assert.equal(entries.length, 7)
        assert.ok(entries.every((entry) => entry.feature === "antinuke" && entry.actorId === "20"))
    })
})

test("An incident is claimed once per account within the window, and dry-run and trust only record", async () => {
    const f = fixture()
    assert.deepEqual(await f.open(), { claimed: false })
    await f.manage({ type: "module", enabled: true })
    const dry = await f.open()
    assert.deepEqual(dry, { claimed: true, incidentNo: 1, act: false, lockdown: false })
    assert.deepEqual(await f.open(), { claimed: false })
    await f.finish(1, "alert", { lockdown: "not-allowed" })
    const [first] = (await f.list({ type: "page" })).incidents
    assert.equal(first!.response, "alert")
    assert.deepEqual(first!.removedRoleIds, [])
    assert.equal(first!.lockdown, "not-allowed")
    await f.manage({ type: "mode", mode: "enforce" })
    await f.manage({ type: "trust", userId: "51", trusted: true })
    assert.deepEqual(await f.open({ actorId: "51" }), { claimed: true, incidentNo: 2, act: false, lockdown: false })
    assert.deepEqual(await f.open({ actorId: "52" }), { claimed: true, incidentNo: 3, act: true, lockdown: false })
    clock += 300001
    assert.equal((await f.open()).claimed, true)
})

test("An outcome is recorded once, a stopped process leaves it uncertain, and an uncertain one settles from a read", async () => {
    const f = fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "mode", mode: "enforce" })
    await f.open()
    assert.deepEqual(await f.finish(1, "succeeded"), { recorded: true, admitted: false })
    assert.deepEqual(await f.finish(1, "failed"), { recorded: false, admitted: false })
    await f.open({ actorId: "60" })
    assert.deepEqual(await f.post("/antinuke/observe", { serverId: "10" }), { uncertain: 1, admitted: false })
    const [latest] = (await f.list({ type: "one", incidentNo: 2 })).incidents
    assert.equal(latest!.outcome, "uncertain")
    const inbox = await f.t.run((ctx) => readRecoveryInbox(ctx, "10"))
    assert.ok(inbox.entries.some((entry) => entry.kind === "work" && entry.source === "antinuke"))
    assert.deepEqual(await f.finish(2, "failed"), { recorded: true, admitted: false })
    assert.equal((await f.list({ type: "one", incidentNo: 2 })).incidents[0]!.outcome, "failed")
})

test("Incidents page newest first and a server keeps its newest 200", async () => {
    const f = fixture()
    await f.manage({ type: "module", enabled: true })
    for (let index = 0; index < 205; index++) {
        clock += 1
        await f.open({ actorId: String(1000 + index) })
    }
    const first = await f.list({ type: "page" })
    assert.deepEqual(first.incidents.map((row) => row.incidentNo).slice(0, 2), [205, 204])
    assert.equal(first.more, true)
    const next = await f.list({ type: "page", before: first.incidents.at(-1)!.incidentNo })
    assert.equal(next.incidents[0]!.incidentNo, 195)
    await f.t.run(async (ctx) => {
        const rows = await ctx.db.query("antiNukeIncidents").collect()
        assert.equal(rows.length, 200)
        assert.equal(Math.min(...rows.map((row) => row.incidentNo)), 6)
    })
    await f.list({ type: "page" }, actor({ isAdministrator: false }), 403)
})

test("A restore finds the member's newest incident with roles to give back and records who did it", async () => {
    const f = fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "mode", mode: "enforce" })
    await f.open()
    await f.finish(1, "succeeded")
    const found = await f.list({ type: "restorable", userId: "50" })
    assert.deepEqual(found.incidents[0]!.removedRoleIds, ["70", "71"])
    assert.deepEqual((await f.list({ type: "restorable", userId: "99" })).incidents, [])
    await f.manage({ type: "restore", userId: "99", result: { incidentNo: 1, outcome: "succeeded" } }, actor(), 404)
    await f.manage({ type: "restore", userId: "50", result: { incidentNo: 1, outcome: "uncertain" } })
    assert.equal((await f.list({ type: "restorable", userId: "50" })).incidents[0]!.restoreOutcome, "uncertain")
    await f.manage({ type: "restore", userId: "50", result: { incidentNo: 1, outcome: "succeeded" } })
    const [row] = (await f.list({ type: "one", incidentNo: 1 })).incidents
    assert.equal(row!.restoredBy, "20")
    assert.deepEqual((await f.list({ type: "restorable", userId: "50" })).incidents, [])
})

test("The setup check says when an incident has nowhere to reach staff, and the staff log gets a note once", async () => {
    const f = fixture()
    const section = async () =>
        (await f.t.run((ctx) => readSetupSections(ctx, "10"))).find((item) => item.id === "antinuke")?.state
    assert.equal(await section(), "off")
    await f.manage({ type: "module", enabled: true })
    // Metadata logs start off, so with no staff log an incident would alert nobody
    assert.equal(await section(), "setup")
    await f.open()
    assert.deepEqual(await f.finish(1, "alert"), { recorded: true, admitted: false })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("moderationSettings", {
            serverId: "10",
            config: { ...defaultSettings(), logChannelId: "60" },
            nextCaseNo: 1,
            nextAppealNo: 1,
        })
    })
    assert.equal(await section(), "on")
    await f.open({ actorId: "60" })
    assert.deepEqual(await f.finish(2, "alert"), { recorded: true, admitted: false, logChannelId: "60" })
    // A status settled later adds no second note
    await f.manage({ type: "mode", mode: "enforce" })
    await f.open({ actorId: "61" })
    await f.post("/antinuke/observe", { serverId: "10" })
    assert.deepEqual(await f.finish(3, "failed"), { recorded: true, admitted: false })
})

test("An earlier alert never keeps NeonFlux from acting, while one response per window still holds", async () => {
    const f = fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "mode", mode: "enforce" })
    assert.equal((await f.open({ response: "alert", removedRoleIds: [] })).claimed, true)
    assert.deepEqual(await f.open({ response: "alert", removedRoleIds: [] }), { claimed: false })
    assert.deepEqual(await f.open(), { claimed: true, incidentNo: 2, act: true, lockdown: false })
    assert.deepEqual(await f.open(), { claimed: false })
    assert.deepEqual(await f.open({ response: "alert", removedRoleIds: [] }), { claimed: false })
})

test("A strip that failed holds nothing to give back, so a later demotion by staff cannot be undone", async () => {
    const f = fixture()
    await f.manage({ type: "module", enabled: true })
    await f.manage({ type: "mode", mode: "enforce" })
    await f.open()
    await f.finish(1, "failed")
    assert.deepEqual((await f.list({ type: "restorable", userId: "50" })).incidents, [])
    // A role that stayed out keeps it open and named
    await f.open({ actorId: "51" })
    await f.finish(2, "succeeded")
    await f.manage({ type: "restore", userId: "51", result: { incidentNo: 2, outcome: "failed", left: ["71"] } })
    const [open] = (await f.list({ type: "restorable", userId: "51" })).incidents
    assert.deepEqual(open!.restoreLeftRoleIds, ["71"])
    await f.manage({ type: "restore", userId: "51", result: { incidentNo: 2, outcome: "succeeded", gone: ["72"] } })
    const [row] = (await f.list({ type: "one", incidentNo: 2 })).incidents
    assert.equal(row!.restoreLeftRoleIds, undefined)
    assert.deepEqual(row!.restoreGoneRoleIds, ["72"])
    // Every website manager reads the audit log, so a restore names its incident and not the account
    await f.t.run(async (ctx) => {
        const entries = await ctx.db.query("auditLogEntries").collect()
        assert.equal(entries.filter((entry) => entry.setting === "restore").length, 2)
        assert.doesNotMatch(JSON.stringify(entries.filter((entry) => entry.setting === "restore")), /"51"|\b51\b/)
    })
})
