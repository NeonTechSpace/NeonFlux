import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import {
    RETENTION_INTERVAL_MS,
    RETENTION_PASSES,
    RETENTION_ROWS_PER_RUN,
    type RetentionRun,
} from "../convex/retention.ts"
import { retentionPass, type RetentionPass } from "../convex/retentionStore.ts"
import { insertDocument } from "./schema-documents.ts"

const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
// Scheduled functions fire only when a test advances the fake timers, which these tests never do. Each test runs the
// chain's scheduled runs itself, one step at a time, so no open-ended chain can run
beforeEach(() => {
    now = start
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
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
type RunArgs = { generation?: number; next?: number }

// Runs one retention run inside an outer transaction and returns its result with the documents and bytes it read
const step = (t: Backend, args: RunArgs = {}) =>
    t.run(async (ctx) => {
        const result: RetentionRun = await ctx.runMutation(internal.retention.run, args)
        const metrics = await ctx.meta.getTransactionMetrics()
        return { result, read: metrics.documentsRead.used, bytes: metrics.bytesRead.used }
    })
// The newest run the chain scheduled, which has not run because the fake timers never advance
const scheduled = (t: Backend) =>
    t.run(async (ctx) => {
        const jobs = (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
            job.name.startsWith("retention"),
        )
        const job = jobs.at(-1)
        return job ? { args: job.args[0] as RunArgs, at: job.scheduledTime, count: jobs.length } : null
    })
const count = (t: Backend, table: "responseReceipts") =>
    t.run(async (ctx) => (await ctx.db.query(table).collect()).length)

test("An idle run visits every module once, reads no rows and schedules nothing", async () => {
    const t = backend()
    const first = await step(t)
    assert.deepEqual(first.result, { next: "idle", passes: RETENTION_PASSES.length, failed: [] })
    assert.equal(first.read, 0)
    now += RETENTION_INTERVAL_MS
    // Later runs read only the chain row, once to check its lease and once to update it
    const second = await step(t)
    assert.deepEqual(second.result, { next: "idle", passes: RETENTION_PASSES.length, failed: [] })
    assert.equal(second.read, 2)
    assert.equal(await scheduled(t), null)
})

test("A backlog drains through continuations that each stay near the read budget, and the cron leaves a running chain alone", async () => {
    const t = backend(),
        receipts = 3000
    await t.run(async (ctx) => {
        for (let index = 0; index < receipts; index++)
            await ctx.db.insert("responseReceipts", {
                serverId: "10",
                messageId: String(1000 + index),
                expiresAt: now - 1,
            })
    })
    const runs = [await step(t)]
    assert.equal(runs[0]!.result.next, "continue")
    assert.equal((await step(t)).result.next, "skipped")
    const stale = await scheduled(t)
    for (let index = 0; index < 5 && runs.at(-1)!.result.next === "continue"; index++)
        runs.push(await step(t, (await scheduled(t))!.args))
    assert.equal(runs.at(-1)!.result.next, "idle")
    assert(
        runs.length >= 2 && runs.slice(0, -1).every((run) => run.result.next === "continue"),
        JSON.stringify(runs.map((run) => run.result)),
    )
    // One pass reads at most 512 rows, so a run ends within one pass of its budget
    for (const run of runs) assert(run.read <= RETENTION_ROWS_PER_RUN + 512, `A run read ${run.read} documents`)
    assert.equal(await count(t, "responseReceipts"), 0)
    // A run from an older chain does nothing
    assert.equal((await step(t, stale!.args)).result.next, "skipped")
})

test("A full batch that cannot make progress waits for the next run instead of repeating", async () => {
    const t = backend()
    // A pass that reports a full batch of rows that all stay due writes nothing
    assert.deepEqual(await t.run((ctx) => retentionPass(ctx, async () => ({ more: true }))), { more: false })
    const progressed = await t.run((ctx) =>
        retentionPass(ctx, async (ctx) => {
            await insertDocument(ctx, "responseReceipts", "10")
            return { more: true }
        }),
    )
    assert.deepEqual(progressed, { more: true })
})

test("A failing pass is isolated, the other modules keep their retention and isolation ends once the pass succeeds", async () => {
    const t = backend()
    // A pass that throws while broken is set stands in for a module whose cleanup fails
    let broken = true
    const passes = RETENTION_PASSES as (readonly [string, RetentionPass])[]
    passes.push([
        "failing",
        async () => {
            if (broken) throw new Error("Synthetic pass failure")
            return { more: false }
        },
    ])
    try {
        await t.run((ctx) => ctx.db.insert("responseReceipts", { serverId: "10", messageId: "1", expiresAt: now - 1 }))
        // Before the first finished run every pass is isolated
        assert.deepEqual((await step(t)).result.failed, ["failing"])
        assert.equal(await count(t, "responseReceipts"), 0)
        now += RETENTION_INTERVAL_MS
        await t.run((ctx) => ctx.db.insert("responseReceipts", { serverId: "10", messageId: "2", expiresAt: now - 1 }))
        assert.deepEqual((await step(t)).result.failed, ["failing"])
        assert.equal(await count(t, "responseReceipts"), 0)
        broken = false
        now += RETENTION_INTERVAL_MS
        assert.deepEqual((await step(t)).result.failed, [])
        // A pass that fails outside isolation fails its run, and the run after a missed one isolates every pass
        broken = true
        now += RETENTION_INTERVAL_MS
        await assert.rejects(step(t), /Synthetic pass failure/)
        now += RETENTION_INTERVAL_MS
        assert.deepEqual((await step(t)).result.failed, ["failing"])
    } finally {
        passes.pop()
    }
})
