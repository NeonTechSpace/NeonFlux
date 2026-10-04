import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/contracts/service"
import { WORK_KINDS, WORK_ROWS_PER_SOURCE, rowDueAt } from "../convex/workDispatch.ts"
import { insertDocument } from "./schema-documents.ts"
import { botCall } from "./bot-service.ts"

const secret = "synthetic-dispatch-backend-secret-0000000000000"
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
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
// Due work of every worker kind for one server, with the settings that let each gated worker act
async function dueWork(ctx: Ctx, serverId: string) {
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
    await insertDocument(ctx, "levelingProfiles", serverId, { rewardDueAt: now - 1000 })
}

test("The work route authenticates, validates its cursor and costs nothing when no server has work", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    assert.equal((await post(t, "/service/work", {}, undefined, "synthetic-wrong-secret-0000000000000000")).status, 401)
    for (const cursor of [5, "", "{", "[]", '{"unknown":[1,2]}', '{"scheduleDeliveries":[1]}'])
        assert.equal((await post(t, "/service/work", { cursor })).status, 400)
    assert.equal((await post(t, "/service/work", { cursor: "x".repeat(5000) })).status, 413)
    assert.deepEqual(await work(t), { kinds: only({}), cursor: null, nextDueIn: null })
})

test("Each worker kind reports exactly the servers its worker would find work for", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        await dueWork(ctx, "10")
        // Server 20 has rows each worker would skip: disabled or restricted features and work due later
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
        await insertDocument(ctx, "levelingProfiles", "20", { rewardDueAt: now + 1000 })
    })
    // Server 20's milestone and level reward rows are due in one second. Gates and the server scope do not hide due times
    assert.deepEqual(await work(t), {
        kinds: only(Object.fromEntries(WORK_KINDS.map((kind) => [kind, ["10"]]))),
        cursor: null,
        nextDueIn: 1000,
    })

    // The workers' own endpoints agree for level rewards
    const levels = async (serverId: string) =>
        (await (await post(t, "/levels/work", { serverId, operation: { type: "list" } }, serverId)).json()) as {
            accounts: unknown[]
        }
    assert.equal((await levels("10")).accounts.length, 1)

    // Server 20 has no work any worker would act on now
    process.env.NEONFLUX_SERVER_ID = "20"
    assert.deepEqual(await work(t), { kinds: only({}), cursor: null, nextDueIn: 1000 })
    assert.equal((await levels("20")).accounts.length, 0)
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
    for (const [serverId, events] of [
        ["10", ["10"]],
        ["20", []],
        ["40", []],
        ["50", []],
        ["60", ["60"]],
    ] as const) {
        process.env.NEONFLUX_SERVER_ID = serverId
        assert.deepEqual((await work(t)).kinds.events, events)
    }
})

test("Large rows stop a page at the read budget, and later pages read only the sources the cursor names", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        servers = Array.from({ length: 30 }, (_, index) => (index === 29 ? "10" : String(3000 + index)))
    // Thirty late reminder rows of about 700 KB each pass Convex's 16 MiB read limit together. The configured server's is last
    for (const [index, serverId] of servers.entries())
        await t.run(async (ctx) => {
            await insertDocument(ctx, "eventDeliveries", serverId, {
                state: "queued",
                dueAt: now - 400000,
                nextCheckAt: now - 5000 + index,
                startsAt: now + 3600000,
                channelId: "x".repeat(700000),
            })
        })
    await t.run(async (ctx) => {
        await insertDocument(ctx, "milestoneEnrollments", "10", { nextCheckAt: now - 1000 })
    })
    const reported: string[] = [],
        milestones: string[] = []
    let page = await work(t),
        pages = 1
    while (true) {
        reported.push(...page.kinds.events)
        milestones.push(...page.kinds.milestones)
        if (page.cursor === null) break
        page = await work(t, page.cursor)
        pages++
    }
    // The configured server's row is reported once in the pass, and so is the later source the budget pushed to another page
    assert.ok(pages > 1)
    assert.deepEqual(reported, ["10"])
    assert.deepEqual(milestones, ["10"])
})

test("Due rows of other servers cannot hide the configured server's work", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend(),
        others = WORK_ROWS_PER_SOURCE + 20
    await t.run(async (ctx) => {
        for (let index = 0; index < others; index++) {
            await insertDocument(ctx, "scheduleDeliveries", String(2000 + index), {
                active: true,
                dueAt: now - 500000 + index,
                nextCheckAt: now - 500000 + index,
            })
        }
        await insertDocument(ctx, "scheduleDeliveries", "10", {
            active: true,
            dueAt: now - 1000,
            nextCheckAt: now - 1000,
        })
    })
    const first = await work(t)
    assert.deepEqual(first.kinds.schedules, [])
    assert.notEqual(first.cursor, null)
    const second = await work(t, first.cursor)
    assert.deepEqual(second.kinds.schedules, ["10"])
    assert.equal(second.cursor, null)
})
test("A fresh read goes on with both a held backlog and a source that became unfinished since", async (tc) => {
    tc.mock.method(Date, "now", () => now)
    const t = backend()
    await t.run(async (ctx) => {
        for (let index = 0; index < 2 * WORK_ROWS_PER_SOURCE + 20; index++) {
            await insertDocument(ctx, "scheduleDeliveries", String(2000 + index), {
                active: true,
                dueAt: now - 500000 + index,
                nextCheckAt: now - 500000 + index,
            })
        }
    })
    const held = (await work(t, (await work(t)).cursor)).cursor
    assert.notEqual(held, null)
    // New work arrives behind a page of rows no worker acts on, in a source the held cursor does not name
    await t.run(async (ctx) => {
        for (let index = 0; index < WORK_ROWS_PER_SOURCE; index++) {
            await insertDocument(ctx, "milestoneEnrollments", String(5000 + index), {
                nextCheckAt: now - 500000 + index,
            })
        }
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
