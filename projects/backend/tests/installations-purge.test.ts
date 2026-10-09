import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import type { TableNames } from "../convex/_generated/dataModel.js"
import { PURGE_AFTER_MS, PURGE_CHILDREN, PURGE_INDEXES, PURGE_ROWS_PER_TABLE, PURGE_SHARED } from "../convex/installationsPurge.ts"
import { hasServerId, insertDocument, serverIndexes, tableNames } from "./schema-documents.ts"

const secret = "synthetic-purge-backend-secret-00000000000000000"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const removedAt = Date.parse("2026-01-01T00:00:00Z")
let now = removedAt
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_MODE = "multi"
    process.env.NEONFLUX_BOT_API_SECRET = secret
    now = removedAt
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
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
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
const installation = (t: Backend, operation: "join" | "leave", serverId: string) =>
    t.fetch(`/service/installations/${operation}`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ serverId }) })
// Runs the cron entry point, then every continuation it schedules
async function purge(t: Backend, drain = true) {
    await t.mutation(internal.installationsPurge.purge, {})
    if (drain) await t.finishAllScheduledFunctions(() => mock.timers.tick(0))
}
// Rows owned by each server in every table, including children owned through their parent
const owned = (t: Backend) => t.run(async ctx => {
    const counts: Record<string, Record<string, number>> = {}
    for (const table of tableNames) for (const row of await ctx.db.query(table).collect() as Record<string, unknown>[]) {
        const link = (PURGE_CHILDREN as Partial<Record<TableNames, { field: string }>>)[table]
        const owner = link ? (await ctx.db.get(row[link.field] as never) as { serverId?: string } | null)?.serverId ?? "orphan" : row.serverId as string | undefined ?? "shared"
        counts[owner] ??= {}
        counts[owner][table] = (counts[owner][table] ?? 0) + 1
    }
    return counts
})

test("Every table is purged by its serverId index, through a purged parent or is shared", () => {
    for (const table of tableNames) {
        if (table === "serverInstallations") continue
        if (hasServerId(table)) {
            const index = (PURGE_INDEXES as Partial<Record<TableNames, string>>)[table]
            assert.ok(index, `${table} holds per-server rows. Add it to PURGE_INDEXES`)
            assert.equal(serverIndexes(table).find(found => found.indexDescriptor === index)?.fields[0], "serverId", `${table}.${index} must start with serverId`)
            continue
        }
        const link = (PURGE_CHILDREN as Partial<Record<TableNames, { parent: TableNames, index: string, field: string }>>)[table]
        if (link) {
            assert.ok(link.parent in PURGE_INDEXES, `${table} parent ${link.parent} must be purged`)
            assert.equal(serverIndexes(table).find(found => found.indexDescriptor === link.index)?.fields[0], link.field, `${table}.${link.index}`)
            continue
        }
        assert.ok(PURGE_SHARED.includes(table), `${table} has no serverId. Purge it through its parent in PURGE_CHILDREN or list it in PURGE_SHARED`)
    }
})

test("A server removed 30 days ago loses every row in every table, and other servers and shared rows stay", async () => {
    const t = backend()
    await t.run(async ctx => {
        for (const serverId of ["10", "20"]) for (const table of tableNames) if (table !== "serverInstallations") await insertDocument(ctx, table, serverId)
        await ctx.db.insert("serverInstallations", { serverId: "10", status: "removed", joinedAt: removedAt - 1000, lastSeenAt: removedAt, removedAt })
        await ctx.db.insert("serverInstallations", { serverId: "20", status: "active", joinedAt: removedAt - 1000, lastSeenAt: removedAt })
    })
    const before = await owned(t)
    const perServer = tableNames.filter(table => table !== "serverInstallations" && !PURGE_SHARED.includes(table))
    for (const table of perServer) assert.ok((before["10"]?.[table] ?? 0) > 0, `${table} has a row for server 10`)

    now = removedAt + PURGE_AFTER_MS - 1
    await purge(t)
    assert.deepEqual(await owned(t), before)

    now = removedAt + PURGE_AFTER_MS
    await purge(t)
    const after = await owned(t)
    assert.equal(after["10"], undefined)
    assert.equal(after.orphan, undefined)
    assert.deepEqual(after["20"], before["20"])
    assert.deepEqual(after.shared, before.shared)
    assert.deepEqual((await t.run(ctx => ctx.db.query("serverInstallations").collect())).map(row => row.serverId), ["20"])
})

test("A purge continues across bounded batches, holds its lease and stops when the server joins again", async () => {
    const rows = PURGE_ROWS_PER_TABLE * 2 + 50
    const seeded = async () => {
        const t = backend()
        await t.run(async ctx => {
            await ctx.db.insert("serverInstallations", { serverId: "10", status: "removed", joinedAt: removedAt - 1000, lastSeenAt: removedAt, removedAt })
            for (let index = 0; index < rows; index++) await ctx.db.insert("afkStatuses", { serverId: "10", userId: String(100 + index), reason: "Away", since: removedAt })
        })
        now = removedAt + PURGE_AFTER_MS + 1
        return t
    }
    const left = (t: Backend) => t.run(async ctx => (await ctx.db.query("afkStatuses").collect()).length)

    const t = await seeded()
    await purge(t, false)
    assert.equal(await left(t), rows - PURGE_ROWS_PER_TABLE)
    // The hourly cron finds the purge running and leaves it to its continuation
    await t.mutation(internal.installationsPurge.purge, {})
    assert.equal(await left(t), rows - PURGE_ROWS_PER_TABLE)
    await t.finishAllScheduledFunctions(() => mock.timers.tick(0))
    assert.equal(await left(t), 0)
    assert.deepEqual(await t.run(ctx => ctx.db.query("serverInstallations").collect()), [])

    const rejoined = await seeded()
    await purge(rejoined, false)
    assert.equal((await installation(rejoined, "join", "10")).status, 200)
    await rejoined.finishAllScheduledFunctions(() => mock.timers.tick(0))
    assert.equal(await left(rejoined), rows - PURGE_ROWS_PER_TABLE)
    assert.deepEqual((await rejoined.run(ctx => ctx.db.query("serverInstallations").collect())).map(row => [row.status, row.purgeLeaseUntil]), [["active", undefined]])
    // Leaving again starts a new 30-day retention for what is left
    assert.equal((await installation(rejoined, "leave", "10")).status, 200)
    now += PURGE_AFTER_MS - 1
    await purge(rejoined)
    assert.equal(await left(rejoined), rows - PURGE_ROWS_PER_TABLE)
    now += 1
    await purge(rejoined)
    assert.equal(await left(rejoined), 0)
})

test("Single mode never purges", async () => {
    delete process.env.NEONFLUX_SERVER_MODE
    process.env.NEONFLUX_SERVER_ID = "20"
    const t = backend()
    await t.run(async ctx => {
        await ctx.db.insert("serverInstallations", { serverId: "10", status: "removed", joinedAt: removedAt - 1000, lastSeenAt: removedAt, removedAt })
        await ctx.db.insert("afkStatuses", { serverId: "10", userId: "100", reason: "Away", since: removedAt })
    })
    now = removedAt + PURGE_AFTER_MS * 2
    await purge(t)
    assert.equal((await t.run(ctx => ctx.db.query("afkStatuses").collect())).length, 1)
    assert.equal((await t.run(ctx => ctx.db.query("serverInstallations").collect())).length, 1)
})
