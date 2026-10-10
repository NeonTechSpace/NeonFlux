import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { RETENTION_INTERVAL_MS, RETENTION_PASSES, RETENTION_ROWS_PER_RUN, type RetentionRun } from "../convex/retention.ts"
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
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
type RunArgs = { generation?: number, next?: number }

// Runs one retention run inside an outer transaction and returns its result with the documents and bytes it read
const step = (t: Backend, args: RunArgs = {}) => t.run(async ctx => {
    const result: RetentionRun = await ctx.runMutation(internal.retention.run, args)
    const metrics = await ctx.meta.getTransactionMetrics()
    return { result, read: metrics.documentsRead.used, bytes: metrics.bytesRead.used }
})
// The newest run the chain scheduled, which has not run because the fake timers never advance
const scheduled = (t: Backend) => t.run(async ctx => {
    const jobs = (await ctx.db.system.query("_scheduled_functions").collect()).filter(job => job.name.startsWith("retention"))
    const job = jobs.at(-1)
    return job ? { args: job.args[0] as RunArgs, at: job.scheduledTime, count: jobs.length } : null
})
const count = (t: Backend, table: "responseReceipts" | "moderationReceipts" | "moderationAppeals" | "securityRecoveries" | "suggestions") => t.run(async ctx => (await ctx.db.query(table).collect()).length)

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
    const t = backend(), receipts = 3000, fences = 600
    await t.run(async ctx => {
        for (let index = 0; index < receipts; index++) await ctx.db.insert("responseReceipts", { serverId: "10", messageId: String(1000 + index), expiresAt: now - 1 })
        for (let index = 0; index < fences; index++) await ctx.db.insert("moderationReceipts", { serverId: "10", key: `message:${index}`, expiresAt: now - 1, claimed: false, blocked: false, createCounted: false, versions: [] })
    })
    const runs = [await step(t)]
    assert.equal(runs[0]!.result.next, "continue")
    assert.equal((await step(t)).result.next, "skipped")
    const stale = await scheduled(t)
    for (let index = 0; index < 5 && runs.at(-1)!.result.next === "continue"; index++) runs.push(await step(t, (await scheduled(t))!.args))
    assert.equal(runs.at(-1)!.result.next, "idle")
    assert(runs.length >= 2 && runs.slice(0, -1).every(run => run.result.next === "continue"), JSON.stringify(runs.map(run => run.result)))
    // One pass reads at most 512 rows, so a run ends within one pass of its budget
    for (const run of runs) assert(run.read <= RETENTION_ROWS_PER_RUN + 512, `A run read ${run.read} documents`)
    assert.equal(await count(t, "responseReceipts"), 0)
    assert.equal(await count(t, "moderationReceipts"), 0)
    // A run from an older chain does nothing
    assert.equal((await step(t, stale!.args)).result.next, "skipped")
})

test("A full batch that cannot make progress waits for the next run instead of repeating", async () => {
    const t = backend()
    await t.run(async ctx => { for (let index = 0; index < 128; index++) await insertDocument(ctx, "moderationAppeals", "10", { appealNo: index + 1, status: "open", expiresAt: now - 1 }) })
    const run = await step(t)
    assert.deepEqual(run.result, { next: "idle", passes: RETENTION_PASSES.length, failed: [] })
    assert.equal(await count(t, "moderationAppeals"), 128)
    assert.equal(await scheduled(t), null)
})

test("A future recovery deadline schedules nothing, and the next run after it deletes the recovery", async () => {
    const t = backend()
    await t.run(ctx => insertDocument(ctx, "securityRecoveries", "10", { status: "active", knownDeadline: now + 180000 }))
    assert.equal((await step(t)).result.next, "idle")
    assert.equal(await scheduled(t), null)
    assert.equal(await count(t, "securityRecoveries"), 1)
    now += RETENTION_INTERVAL_MS
    assert.equal((await step(t)).result.next, "idle")
    assert.equal(await count(t, "securityRecoveries"), 0)
})

test("A failing pass is isolated, the other modules keep their retention and isolation ends once the pass succeeds", async () => {
    const t = backend()
    // A pending attempt whose ticket is missing makes the ticket pass fail
    const broken = await t.run(async ctx => {
        await ctx.db.insert("responseReceipts", { serverId: "10", messageId: "1", expiresAt: now - 1 })
        return insertDocument(ctx, "ticketAttempts", "10", { ticketNo: 99, outcome: "pending", dispatchExpiresAt: now - 3600000 })
    })
    // Before the first finished run every pass is isolated
    assert.deepEqual((await step(t)).result.failed, ["tickets"])
    assert.equal(await count(t, "responseReceipts"), 0)
    now += RETENTION_INTERVAL_MS
    await t.run(ctx => ctx.db.insert("responseReceipts", { serverId: "10", messageId: "2", expiresAt: now - 1 }))
    assert.deepEqual((await step(t)).result.failed, ["tickets"])
    assert.equal(await count(t, "responseReceipts"), 0)
    await t.run(ctx => ctx.db.delete(broken))
    now += RETENTION_INTERVAL_MS
    assert.deepEqual((await step(t)).result.failed, [])
    // A pass that fails outside isolation fails its run, and the run after a missed one isolates every pass
    const again = await t.run(ctx => insertDocument(ctx, "ticketAttempts", "10", { ticketNo: 99, outcome: "pending", dispatchExpiresAt: now - 3600000 }))
    now += RETENTION_INTERVAL_MS
    await assert.rejects(step(t), /Ticket not found/)
    now += RETENTION_INTERVAL_MS
    assert.deepEqual((await step(t)).result.failed, ["tickets"])
    await t.run(ctx => ctx.db.delete(again))
})

test("A pending leveling sweep advances when it belongs to a server after the first batch of leveling servers", async () => {
    const t = backend()
    await t.run(async ctx => {
        for (let index = 0; index < 40; index++) await insertDocument(ctx, "levelingSettings", String(100 + index), { sweepPending: false })
        await insertDocument(ctx, "levelingSettings", "200", { sweepPending: true })
        for (let index = 0; index < 25; index++) await insertDocument(ctx, "levelingProfiles", "200", { userId: String(1000 + index) })
    })
    await t.mutation(internal.levelingCleanup.cleanup, {})
    const state = await t.run(ctx => ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", "200")).unique())
    assert.equal(state!.sweepAfterUserId, "1019")
    assert.equal(state!.sweepPending, true)
    // The chain finishes the sweep in the same run
    await step(t)
    const done = await t.run(ctx => ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", "200")).unique())
    assert.equal(done!.sweepPending, false)
})

test("One run forgets every due suggestion, not only the first", async () => {
    const t = backend()
    await t.run(async ctx => {
        await insertDocument(ctx, "suggestionSettings", "10", { suggestions: 2 })
        for (const suggestionNo of [1, 2]) await insertDocument(ctx, "suggestions", "10", { suggestionNo, state: "withdrawn", cleanupAt: now - 1, voters: 0, up: 0, down: 0 })
    })
    assert.deepEqual((await step(t)).result.next, "idle")
    assert.equal(await count(t, "suggestions"), 0)
})
