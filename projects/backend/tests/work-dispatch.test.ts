import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/contracts/service"
import { defaultRolesSettings } from "../convex/rolesDomain.ts"
import { WORK_KINDS, WORK_ROWS_PER_SOURCE, WORK_SERVERS_PER_KIND, rowDueAt } from "../convex/workDispatch.ts"
import { insertDocument } from "./schema-documents.ts"
import { botCall } from "./bot-service.ts"

const secret = "synthetic-dispatch-backend-secret-0000000000000"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_MODE = "multi"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    for (const key of keys) {
        if (original[key] === undefined) delete process.env[key]
        else process.env[key] = original[key]
    }
})

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
type Ctx = Parameters<Parameters<Backend["run"]>[0]>[0]
const now = Date.parse("2026-06-01T12:00:00Z")

function post(t: Backend, path: string, body: unknown, serverId?: string, secret?: string) {
    return botCall(t, path, body, { serverId, ...(secret === undefined ? {} : { secret }) })
}
async function work(t: Backend, cursor: string | null = null, held?: string | null) {
    const response = await post(t, "/service/work", { cursor, ...(held === undefined ? {} : { held }) })
    assert.equal(response.status, 200)
    return (await response.json()) as ServiceWork
}
const only = (serverIds: Partial<Record<ServiceWorkKind, string[]>>) =>
    Object.fromEntries(WORK_KINDS.map((kind) => [kind, serverIds[kind] ?? []]))
async function install(ctx: Ctx, serverId: string, status: "active" | "removed" = "active") {
    await ctx.db.insert("serverInstallations", {
        serverId,
        status,
        joinedAt: now - 1000,
        ...(status === "removed" ? { removedAt: now - 1000 } : {}),
    })
}
async function defcon(ctx: Ctx, serverId: string, level: 1 | 2 | 3) {
    const id = await insertDocument(ctx, "moderationSettings", serverId)
    await ctx.db.patch(id, { config: { ...(await ctx.db.get(id))!.config, defcon: level } })
}
// Due work of every worker kind for one server, with the settings that let each gated worker act
async function dueWork(ctx: Ctx, serverId: string) {
    const live = { createdAt: now - 5000, expiresAt: now + 60000 }
    await insertDocument(ctx, "dashboardConfigurationJobs", serverId, { state: "queued", ...live })
    await insertDocument(ctx, "dashboardRoleJobs", serverId, { state: "configured", ...live })
    await insertDocument(ctx, "roleSettings", serverId, {
        config: { ...defaultRolesSettings(), verificationEnabled: true, advancedVerificationEnabled: true },
    })
    await insertDocument(ctx, "verificationLinks", serverId, { status: "solved", createdAt: now - 5000 })
    await insertDocument(ctx, "eventSettings", serverId, { enabled: true })
    await insertDocument(ctx, "eventDeliveries", serverId, {
        state: "queued",
        dueAt: now - 1000,
        nextCheckAt: now - 1000,
        startsAt: now + 3600000,
    })
    await insertDocument(ctx, "scheduleDeliveries", serverId, {
        active: true,
        dueAt: now - 1000,
        nextCheckAt: now - 1000,
    })
    await insertDocument(ctx, "milestoneEnrollments", serverId, { nextCheckAt: now - 1000 })
    await insertDocument(ctx, "suggestionSettings", serverId, { enabled: true })
    await insertDocument(ctx, "suggestions", serverId, { dirty: true, nextCheckAt: now - 1000 })
    await insertDocument(ctx, "cleanupSettings", serverId, { enabled: true })
    await insertDocument(ctx, "cleanupPolicies", serverId, { enabled: true, nextCheckAt: now - 1000 })
    await insertDocument(ctx, "metadataLogRecords", serverId, { actionable: true, nextCheckAt: now - 1000 })
    await insertDocument(ctx, "levelingProfiles", serverId, { rewardDueAt: now - 1000 })
    await insertDocument(ctx, "temporaryRoleGrants", serverId, { endsAt: now - 1000, nextCheckAt: now - 1000 })
    await insertDocument(ctx, "helpDeskPosts", serverId, { nudgeAt: now - 1000 })
    await insertDocument(ctx, "lfgGroups", serverId, { expiresAt: now - 1000 })
}

test("The work route authenticates, validates its cursor and costs nothing when no server has work", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    assert.equal((await post(t, "/service/work", {}, undefined, "synthetic-wrong-secret-0000000000000000")).status, 401)
    for (const cursor of [5, "", "{", "[]", '{"unknown":[1,2]}', '{"cleanupPolicies":[1]}'])
        assert.equal((await post(t, "/service/work", { cursor })).status, 400)
    assert.equal((await post(t, "/service/work", { cursor: "x".repeat(5000) })).status, 413)
    await t.run(async (ctx) => {
        await install(ctx, "10")
        await install(ctx, "20")
    })
    assert.deepEqual(await work(t), { kinds: only({}), cursor: null, nextDueIn: null })
})

test("Each worker kind reports exactly the active servers its worker would find work for", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        await install(ctx, "10")
        await dueWork(ctx, "10")
        // Server 20 has rows each worker would skip: expired or settled jobs, disabled or restricted features and work due later
        await install(ctx, "20")
        await insertDocument(ctx, "dashboardConfigurationJobs", "20", {
            state: "queued",
            createdAt: now - 5000,
            expiresAt: now - 1,
        })
        await insertDocument(ctx, "dashboardMessageJobs", "20", {
            state: "sent",
            createdAt: now - 5000,
            expiresAt: now + 60000,
        })
        await insertDocument(ctx, "verificationLinks", "20", { status: "solved", createdAt: now - 5000 })
        await insertDocument(ctx, "eventDeliveries", "20", {
            state: "queued",
            dueAt: now + 60000,
            nextCheckAt: now + 60000,
            startsAt: now + 3600000,
        })
        // A reminder that is due while events are off waits for them
        await insertDocument(ctx, "eventDeliveries", "20", {
            state: "blocked",
            dueAt: now - 1000,
            nextCheckAt: now - 1000,
            startsAt: now + 3600000,
        })
        await insertDocument(ctx, "scheduleDeliveries", "20", {
            active: true,
            dueAt: now + 86400000,
            nextCheckAt: now - 1000,
        })
        await insertDocument(ctx, "scheduleDeliveries", "20", {
            active: true,
            dueAt: now - 1000,
            nextCheckAt: now + 59000,
        })
        await insertDocument(ctx, "milestoneEnrollments", "20", { nextCheckAt: now + 1000 })
        await insertDocument(ctx, "suggestions", "20", { dirty: true, nextCheckAt: now - 1000 })
        await insertDocument(ctx, "cleanupSettings", "20", { enabled: true })
        await insertDocument(ctx, "cleanupPolicies", "20", { enabled: true, nextCheckAt: now - 1000 })
        await defcon(ctx, "20", 1)
        await insertDocument(ctx, "metadataLogRecords", "20", { actionable: false, nextCheckAt: now - 1000 })
        await insertDocument(ctx, "levelingProfiles", "20", { rewardDueAt: now + 1000 })
        await insertDocument(ctx, "temporaryRoleGrants", "20", { endsAt: now + 1000, nextCheckAt: now + 1000 })
        await insertDocument(ctx, "helpDeskPosts", "20", { nudgeAt: now + 1000 })
        await insertDocument(ctx, "lfgGroups", "20", { expiresAt: now + 1000 })
        // Server 30 was removed and keeps due work of every kind
        await install(ctx, "30", "removed")
        await dueWork(ctx, "30")
    })
    // Server 20's milestone, level reward, temporary role, help desk and group rows are due in one second. Gates and installations do not hide due times
    assert.deepEqual(await work(t), {
        kinds: only(Object.fromEntries(WORK_KINDS.map((kind) => [kind, ["10"]]))),
        dashboard: { "10": ["configuration", "roles"] },
        cursor: null,
        nextDueIn: 1000,
    })

    // The workers' own endpoints agree for cleanup and level rewards
    const cleanup = async (serverId: string) =>
        post(t, "/cleanup/work", { serverId, operation: { type: "list" } }, serverId)
    assert.equal(((await (await cleanup("10")).json()) as { policies: unknown[] }).policies.length, 1)
    assert.equal((await cleanup("20")).status, 403)
    const levels = async (serverId: string) =>
        (await (await post(t, "/levels/work", { serverId, operation: { type: "list" } }, serverId)).json()) as {
            accounts: unknown[]
        }
    assert.equal((await levels("10")).accounts.length, 1)
    assert.equal((await levels("20")).accounts.length, 0)

    // Removal hides a server at once and joining again reports its retained work
    assert.equal((await post(t, "/service/installations/leave", { serverId: "10" })).status, 200)
    assert.equal((await post(t, "/service/installations/join", { serverId: "30" })).status, 200)
    assert.deepEqual(await work(t), {
        kinds: only(Object.fromEntries(WORK_KINDS.map((kind) => [kind, ["30"]]))),
        dashboard: { "30": ["configuration", "roles"] },
        cursor: null,
        nextDueIn: 1000,
    })

    // Single mode reports only its configured server
    delete process.env.NEONFLUX_SERVER_MODE
    process.env.NEONFLUX_SERVER_ID = "10"
    assert.deepEqual(await work(t), {
        kinds: only(Object.fromEntries(WORK_KINDS.map((kind) => [kind, ["10"]]))),
        dashboard: { "10": ["configuration", "roles"] },
        cursor: null,
        nextDueIn: 1000,
    })
})

test("Dashboard work names the passes each server needs, so the bot reads only those job kinds", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        live = { state: "queued" as const, createdAt: now - 5000, expiresAt: now + 60000 }
    await t.run(async (ctx) => {
        await install(ctx, "10")
        await install(ctx, "20")
        await insertDocument(ctx, "dashboardConfigurationJobs", "10", { ...live, family: "member" })
        await insertDocument(ctx, "dashboardConfigurationJobs", "10", { ...live, family: "member-profile" })
        await insertDocument(ctx, "dashboardSetupJobs", "10", live)
        // An expired job of an already listed server adds no pass
        await insertDocument(ctx, "dashboardRoleJobs", "10", { ...live, expiresAt: now - 1 })
        await insertDocument(ctx, "dashboardMetadataJobs", "20", live)
    })
    const result = await work(t)
    assert.deepEqual(result.kinds.dashboard, ["10", "20"])
    assert.deepEqual(result.dashboard, { "10": ["rolepicker", "profile", "setup"], "20": ["metadata"] })
})

test("Due discussion threads wake the events worker of enabled servers and name their next time", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        for (const [serverId, enabled, threadDueAt] of [
            ["10", true, now - 1000],
            ["20", false, now - 1000],
            ["30", true, now + 60000],
            ["40", true, undefined],
        ] as const) {
            await install(ctx, serverId)
            await insertDocument(ctx, "eventSettings", serverId, { enabled, threads: true })
            await insertDocument(ctx, "events", serverId, {
                eventNo: 1,
                revision: 1,
                state: "open",
                ...(threadDueAt !== undefined ? { threadDueAt } : {}),
            })
        }
    })
    const result = await work(t)
    assert.deepEqual(result.kinds.events, ["10"])
    assert.equal(result.nextDueIn, 60000)
})
test("Waitlist promotions are reported only for open occurrences of live events in enabled servers", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        const occurrence = (serverId: string, overrides: Record<string, unknown> = {}) =>
            insertDocument(ctx, "eventOccurrences", serverId, {
                eventNo: 1,
                revision: 1,
                state: "open",
                workActive: true,
                nextCheckAt: now - 1000,
                date: {
                    localMinute: "2026-06-02T12:00",
                    startsAt: now + 3600000,
                    endsAt: now + 7200000,
                    offsetMinutes: 0,
                },
                ...overrides,
            })
        for (const [serverId, enabled, eventState] of [
            ["10", true, "open"],
            ["20", false, "open"],
            ["40", true, "cancelled"],
            ["50", true, "open"],
            ["60", true, "open"],
        ] as const) {
            await install(ctx, serverId)
            await insertDocument(ctx, "eventSettings", serverId, { enabled })
            await insertDocument(ctx, "events", serverId, { eventNo: 1, revision: 1, state: eventState })
        }
        await occurrence("10")
        await occurrence("20")
        await occurrence("40")
        // A held lease waits, and an occurrence that already started only closes its work
        await occurrence("50", { leaseExpiresAt: now + 30000 })
        await occurrence("60", {
            date: { localMinute: "2026-06-01T11:00", startsAt: now - 60000, endsAt: now + 60000, offsetMinutes: 0 },
        })
    })
    assert.deepEqual((await work(t)).kinds.events, ["10", "60"])
})

test("Output is bounded per kind, oldest due first, and a full page continues from the cursor", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        servers = Array.from({ length: 150 }, (_, index) => String(1000 + index))
    await t.run(async (ctx) => {
        for (const [index, serverId] of servers.entries()) {
            await install(ctx, serverId)
            await insertDocument(ctx, "milestoneEnrollments", serverId, { nextCheckAt: now - 200000 + index })
        }
    })
    const first = await work(t)
    assert.equal(WORK_SERVERS_PER_KIND, 100)
    assert.deepEqual(first.kinds.milestones, servers.slice(0, 100))
    assert.notEqual(first.cursor, null)
    const second = await work(t, first.cursor)
    assert.deepEqual(second.kinds.milestones, servers.slice(100))
    assert.equal(second.cursor, null)
    assert.deepEqual((await work(t, second.cursor)).kinds.milestones, servers.slice(0, 100))
})

test("Large job rows stop a page at the read budget, and later pages read only the sources the cursor names", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        servers = Array.from({ length: 30 }, (_, index) => String(3000 + index))
    // Thirty queued job rows of about 700 KB each pass Convex's 16 MiB read limit together
    for (const [index, serverId] of servers.entries())
        await t.run(async (ctx) => {
            await install(ctx, serverId)
            await insertDocument(ctx, "dashboardConfigurationJobs", serverId, {
                state: "queued",
                createdAt: now - 5000 + index,
                expiresAt: now + 60000,
                operation: "x".repeat(700000),
            })
        })
    await t.run(async (ctx) => {
        await install(ctx, "10")
        await insertDocument(ctx, "milestoneEnrollments", "10", { nextCheckAt: now - 1000 })
    })
    const reported: string[] = [],
        milestones: string[] = []
    let page = await work(t),
        pages = 1
    while (true) {
        reported.push(...page.kinds.dashboard)
        milestones.push(...page.kinds.milestones)
        if (page.cursor === null) break
        page = await work(t, page.cursor)
        pages++
    }
    // Each row is reported once in the pass, including the later source the budget pushed to another page
    assert.ok(pages > 1)
    assert.deepEqual(reported, servers)
    assert.deepEqual(milestones, ["10"])
})

test("Due rows of removed servers cannot hide an active server's work", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        removed = WORK_ROWS_PER_SOURCE + 20
    await t.run(async (ctx) => {
        for (let index = 0; index < removed; index++) {
            await install(ctx, String(2000 + index), "removed")
            await insertDocument(ctx, "cleanupPolicies", String(2000 + index), {
                enabled: true,
                nextCheckAt: now - 500000 + index,
            })
        }
        await install(ctx, "10")
        await insertDocument(ctx, "cleanupSettings", "10", { enabled: true })
        await insertDocument(ctx, "cleanupPolicies", "10", { enabled: true, nextCheckAt: now - 1000 })
    })
    const first = await work(t)
    assert.deepEqual(first.kinds.cleanup, [])
    assert.notEqual(first.cursor, null)
    const second = await work(t, first.cursor)
    assert.deepEqual(second.kinds.cleanup, ["10"])
    assert.equal(second.cursor, null)
})
test("A fresh read goes on with both a held backlog and a source that became unfinished since", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        for (let index = 0; index < 2 * WORK_ROWS_PER_SOURCE + 20; index++) {
            await install(ctx, String(2000 + index), "removed")
            await insertDocument(ctx, "cleanupPolicies", String(2000 + index), {
                enabled: true,
                nextCheckAt: now - 500000 + index,
            })
        }
    })
    const held = (await work(t, (await work(t)).cursor)).cursor
    assert.notEqual(held, null)
    // New work arrives behind a page of rows no worker acts on, in a source the held cursor does not name
    await t.run(async (ctx) => {
        for (let index = 0; index < WORK_ROWS_PER_SOURCE; index++) {
            await install(ctx, String(5000 + index), "removed")
            await insertDocument(ctx, "milestoneEnrollments", String(5000 + index), {
                nextCheckAt: now - 500000 + index,
            })
        }
        await install(ctx, "10")
        await insertDocument(ctx, "milestoneEnrollments", "10", { nextCheckAt: now - 1000 })
    })
    const fresh = await work(t, null, held)
    assert.deepEqual(fresh.kinds.milestones, [])
    // The held backlog has one short page left, and the new source goes on to the waiting server
    const next = await work(t, fresh.cursor)
    assert.deepEqual(next.kinds.milestones, ["10"])
    assert.equal(next.cursor, null)
})

test("A deferred scheduled post is listed and timed by its retry time, not its original due time", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        await install(ctx, "10")
        await insertDocument(ctx, "scheduleDeliveries", "10", {
            active: true,
            dueAt: now - 60000,
            nextCheckAt: now + 60000,
        })
    })
    const waiting = await work(t)
    assert.deepEqual(waiting.kinds.schedules, [])
    assert.equal(waiting.nextDueIn, 60000)
    assert.equal(
        rowDueAt("scheduleDeliveries", { active: true, dueAt: now - 60000, nextCheckAt: now + 60000 }, now),
        now + 60000,
    )
})
