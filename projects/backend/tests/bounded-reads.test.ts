import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { MutationCtx } from "../convex/_generated/server.js"
import { internal } from "../convex/_generated/api.js"
import { backupOriginCapacity, backupSetRetention } from "../convex/backupStore.ts"
import { metadataCounters } from "../convex/metadataLogsStore.ts"
import { cleanupModeration } from "../convex/moderation.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { countActiveTickets } from "../convex/ticketStore.ts"
import { rankLevelingBackfill } from "../convex/levelingStore.ts"
import type { LevelingQueryResult, LevelingRank } from "../contracts.js"
import { insertDocument } from "./schema-documents.ts"

// Each test seeds a large table and measures one bounded read with the transaction metrics Convex enforces its limits by
const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
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
// Service functions check the configured server, here single mode for server 10
function serveSingle(t: TestContext) {
    const scope = process.env.NEONFLUX_SERVER_ID, mode = process.env.NEONFLUX_SERVER_MODE
    process.env.NEONFLUX_SERVER_ID = "10"; delete process.env.NEONFLUX_SERVER_MODE
    t.after(() => {
        if (scope === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = scope
        if (mode !== undefined) process.env.NEONFLUX_SERVER_MODE = mode
    })
}
// Runs fn in one transaction and returns its value with the documents and bytes it read
const measure = (t: Backend, fn: (ctx: MutationCtx) => Promise<unknown>) => t.run(async ctx => {
    const before = await ctx.meta.getTransactionMetrics()
    const value = await fn(ctx)
    const after = await ctx.meta.getTransactionMetrics()
    return { value: value ?? null, read: after.documentsRead.used - before.documentsRead.used, bytes: after.bytesRead.used - before.bytesRead.used }
})

test("Restore steps check plan anchors and origin capacity without reading the plan's items or every origin", async () => {
    const t = backend(), provider = "synthetic-provider"
    const planId = await t.run(async ctx => {
        const plan = await insertDocument(ctx, "backupPlans", "10", { provider, expiresAt: now + 3600000 })
        for (let itemNo = 1; itemNo <= 500; itemNo++) await ctx.db.insert("backupItems", { serverId: "10", planId: plan, itemNo, generation: 1, category: "xp", family: "xp", sourceId: String(itemNo), disposition: "create", reason: null, state: "created", expectedHash: "a".repeat(64), desiredHash: "b".repeat(64), dependencyItemNo: null, mappedId: String(itemNo), disabledOnCreate: false, object: { sourceId: String(itemNo), userId: String(itemNo), xp: 100 } })
        for (let index = 0; index < 4000; index++) await ctx.db.insert("backupOrigins", { provider, serverId: "10", category: "xp", family: "xp", sourceId: String(index), state: "created", planId: plan, itemNo: 1, generation: 1, mappedId: String(index), desiredHash: "b".repeat(64) })
        return plan
    })
    const resolved = await measure(t, async ctx => backupSetRetention(ctx, (await ctx.db.get(planId))!))
    assert(resolved.read <= 2, `Retention read ${resolved.read} documents`)
    assert.notEqual((await t.run(ctx => ctx.db.get(planId)))!.cleanupAt, undefined)
    // One unresolved item still keeps the plan's anchors
    await t.run(async ctx => { const item = (await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", planId).eq("itemNo", 250)).unique())!; await ctx.db.patch(item._id, { state: "uncertain" }) })
    const unresolved = await measure(t, async ctx => backupSetRetention(ctx, (await ctx.db.get(planId))!))
    assert(unresolved.read <= 3, `Retention read ${unresolved.read} documents`)
    assert.equal((await t.run(ctx => ctx.db.get(planId)))!.cleanupAt, undefined)
    // The first count of a provider reads its origins once, and later origins read only the count
    const first = await measure(t, ctx => backupOriginCapacity(ctx, "10", provider))
    assert(first.read <= 4001, `First count read ${first.read} documents`)
    const later = await measure(t, ctx => backupOriginCapacity(ctx, "10", provider))
    assert(later.read <= 2, `Capacity read ${later.read} documents`)
    assert.equal((await t.run(ctx => ctx.db.query("backupOriginCounts").first()))!.count, 4002)
})

test("Metadata log counters read settings rows instead of counting tickets and moderation cases", async () => {
    const t = backend()
    await t.run(async ctx => {
        await ctx.db.insert("moderationSettings", { serverId: "10", config: defaultSettings(), nextCaseNo: 2501, nextAppealNo: 1 })
        for (let caseNo = 1; caseNo <= 2500; caseNo++) await insertDocument(ctx, "moderationCases", "10", { caseNo, expiresAt: caseNo <= 10 ? now - 1 : now + 86400000 })
        await insertDocument(ctx, "ticketSettings", "10", { activeTickets: 300 })
        for (let ticketNo = 1; ticketNo <= 300; ticketNo++) await insertDocument(ctx, "tickets", "10", { ticketNo, active: true })
    })
    const counters = async () => {
        const measured = await measure(t, ctx => metadataCounters(ctx, "10"))
        const value = measured.value as Awaited<ReturnType<typeof metadataCounters>>
        return { read: measured.read, cases: value.retainedModerationCases, tickets: value.activeTicketSlots }
    }
    const counted = await counters()
    assert.deepEqual({ cases: counted.cases, tickets: counted.tickets }, { cases: 2500, tickets: 300 })
    assert(counted.read <= 3, `Counters read ${counted.read} documents`)
    // Retention counts each removed case
    await t.run(ctx => cleanupModeration(ctx, now))
    assert.equal((await counters()).cases, 2490)
    // A ticket count from before counting is read as before until the next active change counts it once
    await t.run(async ctx => { const row = (await ctx.db.query("ticketSettings").first())!; await ctx.db.patch(row._id, { activeTickets: undefined }) })
    assert.equal((await counters()).tickets, 300)
    await t.run(async ctx => {
        const ticket = (await ctx.db.query("tickets").withIndex("by_number", q => q.eq("serverId", "10").eq("ticketNo", 1)).unique())!
        await ctx.db.patch(ticket._id, { active: false })
        await countActiveTickets(ctx, "10", -1)
    })
    const recounted = await counters()
    assert.equal(recounted.tickets, 299)
    assert(recounted.read <= 3, `Counters read ${recounted.read} documents`)
})

test("A repeat rule reads only the member's windows with the same content", async t => {
    serveSingle(t)
    const b = backend(), hash = (value: number) => value.toString(16).padStart(64, "0")
    await b.run(async ctx => {
        await ctx.db.insert("moderationSettings", { serverId: "10", config: { ...defaultSettings(), automodEnabled: true }, nextCaseNo: 1, nextAppealNo: 1 })
        await ctx.db.insert("automodRules", { serverId: "10", name: "repeat", rule: { name: "repeat", type: "repeat", enabled: true, priority: 0, action: "warn", threshold: 3, windowSeconds: 300, durationSeconds: 900, patterns: [], domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: [] } })
        // A busy member's 1,000 other messages inside the five-minute window
        for (let index = 0; index < 1000; index++) await ctx.db.insert("automodWindows", { serverId: "10", userId: "20", channelId: "30", kind: "message", contentHash: hash(index + 1), timestamp: now - 1000, expiresAt: now + 299000 })
    })
    const event = (messageId: string) => ({ serverId: "10", messageId, createdAt: now, event: "create", userId: "20", channelId: "30", roleIds: [], content: "same", contentHash: hash(5000),
        mentionedUserIds: [], mentionedRoleIds: [], mentionedEveryone: false, targetIsStaff: false,
        context: { botId: "999", botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null, botAuthorizedActions: ["log", "warn"] } })
    const evaluate = (messageId: string) => measure(b, ctx => ctx.runMutation(internal.protection.evaluate, { request: event(messageId) }))
    const first = await evaluate("100")
    assert(first.read <= 20, `Evaluation read ${first.read} documents`)
    assert.equal((first.value as { blocked: boolean }).blocked, false)
    await evaluate("101")
    // The third copy reaches the threshold
    const third = await evaluate("102")
    assert(third.read <= 30, `Evaluation read ${third.read} documents`)
    assert.equal((await b.run(ctx => ctx.db.query("moderationCases").collect())).length, 1)
})

test("A rank sums level counts and reads at most 101 profiles, exact or a true range in a crowded level", async t => {
    serveSingle(t)
    const b = backend(), members = 3400
    // 3,000 members spread over 63 levels and 400 more tied at 50 XP in level 0
    const xpOf = (index: number) => index < 3000 ? 100 + (index * 7919) % 400000 : 50, userOf = (index: number) => String(100000 + index)
    await b.run(async ctx => {
        await insertDocument(ctx, "levelingSettings", "10", { profiles: members })
        for (let index = 0; index < members; index++) await ctx.db.insert("levelingProfiles", { serverId: "10", userId: userOf(index), xp: xpOf(index), scoreEpoch: 1, adjustmentRevision: 0, digests: [] })
    })
    // Positions as the leaderboard orders them, by XP and then account ID, highest first
    const order = Array.from({ length: members }, (_, index) => index).sort((a, c) => xpOf(c) - xpOf(a) || (userOf(c) < userOf(a) ? -1 : 1))
    const expected = new Map(order.map((index, position) => [userOf(index), position + 1]))
    const actor = { originServerId: "10", userId: "1", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
    const member = { userId: "1", joinedAt: "2023-11-14T22:00:00.000000Z", roleIds: [], isBot: false, timeoutUntil: null }
    const rank = async (userId: string) => {
        const measured = await measure(b, ctx => ctx.runQuery(internal.leveling.query, { request: { serverId: "10", actor, member, observedAt: now, operation: { type: "rank", userId } } }))
        return { rank: (measured.value as Extract<LevelingQueryResult, { type: "rank" }>).rank, read: measured.read, bytes: measured.bytes }
    }
    // Before a server's counts exist, ranks stay exact within the top 1,000 and read at most the 1,000 profiles above
    const topBefore = await rank(userOf(order[0]!)), deepBefore = await rank(userOf(order[2000]!))
    assert.deepEqual(topBefore.rank, { type: "exact", position: 1 })
    assert.deepEqual(deepBefore.rank, { type: "outside-top-1000" })
    assert(deepBefore.read <= 1010, `Legacy rank read ${deepBefore.read} documents`)
    // The retention chain counts the server's profiles 256 at a time
    for (let pass = 0; pass < 20 && await b.run(ctx => rankLevelingBackfill(ctx)); pass++);
    assert.equal((await b.run(ctx => ctx.db.query("levelingSettings").first()))!.ranked, true)
    const contains = (result: LevelingRank, position: number) => result.type === "exact" ? result.position === position : result.type === "range" && result.from <= position && position <= result.to
    for (const index of [0, 5, 77, 1500, 2999, 3000, 3399]) {
        const userId = userOf(index), measured = await rank(userId)
        assert(contains(measured.rank, expected.get(userId)!), `${userId} at ${expected.get(userId)} read as ${JSON.stringify(measured.rank)}`)
        assert(measured.read <= 200, `Rank read ${measured.read} documents`)
    }
    // The highest account ID in the tied crowd is exact, and the lowest has 399 tied members above it, so it reads as a range
    assert.deepEqual((await rank(userOf(3399))).rank, { type: "exact", position: 3001 })
    assert.deepEqual((await rank(userOf(3000))).rank, { type: "range", from: 3102, to: 3400 })
})
