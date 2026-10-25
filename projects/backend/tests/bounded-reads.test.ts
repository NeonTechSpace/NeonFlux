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
import type { LevelingQueryResult } from "@neonflux/contracts/leveling"
import { countedProfile, insertDocument } from "./schema-documents.ts"

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
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
// Service functions check the configured server, here single mode for server 10
function serveSingle(t: TestContext) {
    const scope = process.env.NEONFLUX_SERVER_ID,
        mode = process.env.NEONFLUX_SERVER_MODE
    process.env.NEONFLUX_SERVER_ID = "10"
    delete process.env.NEONFLUX_SERVER_MODE
    t.after(() => {
        if (scope === undefined) delete process.env.NEONFLUX_SERVER_ID
        else process.env.NEONFLUX_SERVER_ID = scope
        if (mode !== undefined) process.env.NEONFLUX_SERVER_MODE = mode
    })
}
// Runs fn in one transaction and returns its value with the documents and bytes it read
const measure = (t: Backend, fn: (ctx: MutationCtx) => Promise<unknown>) =>
    t.run(async (ctx) => {
        const before = await ctx.meta.getTransactionMetrics()
        const value = await fn(ctx)
        const after = await ctx.meta.getTransactionMetrics()
        return {
            value: value ?? null,
            read: after.documentsRead.used - before.documentsRead.used,
            bytes: after.bytesRead.used - before.bytesRead.used,
        }
    })

test("Restore steps check plan anchors and origin capacity without reading the plan's items or every origin", async () => {
    const t = backend(),
        provider = "synthetic-provider"
    const planId = await t.run(async (ctx) => {
        const plan = await insertDocument(ctx, "backupPlans", "10", { provider, expiresAt: now + 3600000 })
        for (let itemNo = 1; itemNo <= 500; itemNo++)
            await ctx.db.insert("backupItems", {
                serverId: "10",
                planId: plan,
                itemNo,
                generation: 1,
                category: "xp",
                family: "xp",
                sourceId: String(itemNo),
                disposition: "create",
                reason: null,
                state: "created",
                expectedHash: "a".repeat(64),
                desiredHash: "b".repeat(64),
                dependencyItemNo: null,
                mappedId: String(itemNo),
                rank: 4,
                object: { sourceId: String(itemNo), userId: String(itemNo), xp: 100 },
            })
        for (let index = 0; index < 4000; index++)
            await ctx.db.insert("backupOrigins", {
                provider,
                serverId: "10",
                category: "xp",
                family: "xp",
                sourceId: String(index),
                state: "created",
                planId: plan,
                itemNo: 1,
                generation: 1,
                mappedId: String(index),
                desiredHash: "b".repeat(64),
            })
        await ctx.db.insert("backupOriginCounts", { serverId: "10", provider, count: 4000 })
        return plan
    })
    const resolved = await measure(t, async (ctx) => backupSetRetention(ctx, (await ctx.db.get(planId))!))
    assert(resolved.read <= 2, `Retention read ${resolved.read} documents`)
    assert.notEqual((await t.run((ctx) => ctx.db.get(planId)))!.cleanupAt, undefined)
    // One unresolved item still keeps the plan's anchors
    await t.run(async (ctx) => {
        const item = (await ctx.db
            .query("backupItems")
            .withIndex("by_plan", (q) => q.eq("planId", planId).eq("itemNo", 250))
            .unique())!
        await ctx.db.patch(item._id, { state: "uncertain" })
    })
    const unresolved = await measure(t, async (ctx) => backupSetRetention(ctx, (await ctx.db.get(planId))!))
    assert(unresolved.read <= 3, `Retention read ${unresolved.read} documents`)
    assert.equal((await t.run((ctx) => ctx.db.get(planId)))!.cleanupAt, undefined)
    // A new origin reads only its provider's count, never the origins
    const counted = await measure(t, (ctx) => backupOriginCapacity(ctx, "10", provider))
    assert(counted.read <= 2, `Capacity read ${counted.read} documents`)
    assert.equal((await t.run((ctx) => ctx.db.query("backupOriginCounts").first()))!.count, 4001)
})

test("Metadata log counters read settings rows instead of counting tickets and moderation cases", async () => {
    const t = backend()
    await t.run(async (ctx) => {
        // The server keeps cases for a day, so the ten older cases are due
        await ctx.db.insert("moderationSettings", {
            serverId: "10",
            config: { ...defaultSettings(), caseRetentionDays: 1 },
            nextCaseNo: 2501,
            nextAppealNo: 1,
        })
        for (let caseNo = 1; caseNo <= 2500; caseNo++)
            await insertDocument(ctx, "moderationCases", "10", {
                caseNo,
                createdAt: caseNo <= 10 ? now - 2 * 86400000 : now,
                expiresAt: caseNo <= 10 ? now - 1 : now + 86400000,
            })
        await insertDocument(ctx, "ticketSettings", "10", { activeTickets: 300 })
        for (let ticketNo = 1; ticketNo <= 300; ticketNo++)
            await insertDocument(ctx, "tickets", "10", { ticketNo, active: true })
    })
    const counters = async () => {
        const measured = await measure(t, (ctx) => metadataCounters(ctx, "10"))
        const value = measured.value as Awaited<ReturnType<typeof metadataCounters>>
        return { read: measured.read, cases: value.retainedModerationCases, tickets: value.activeTicketSlots }
    }
    const counted = await counters()
    assert.deepEqual({ cases: counted.cases, tickets: counted.tickets }, { cases: 2500, tickets: 300 })
    assert(counted.read <= 3, `Counters read ${counted.read} documents`)
    // Retention counts each removed case
    await t.run((ctx) => cleanupModeration(ctx, now))
    assert.equal((await counters()).cases, 2490)
    // Each active change updates the ticket count
    await t.run(async (ctx) => {
        const ticket = (await ctx.db
            .query("tickets")
            .withIndex("by_number", (q) => q.eq("serverId", "10").eq("ticketNo", 1))
            .unique())!
        await ctx.db.patch(ticket._id, { active: false })
        await countActiveTickets(ctx, "10", -1)
    })
    const recounted = await counters()
    assert.equal(recounted.tickets, 299)
    assert(recounted.read <= 3, `Counters read ${recounted.read} documents`)
})

test("A repeat rule reads only the member's windows with the same content", async (t) => {
    serveSingle(t)
    const b = backend(),
        hash = (value: number) => value.toString(16).padStart(64, "0")
    await b.run(async (ctx) => {
        await ctx.db.insert("moderationSettings", {
            serverId: "10",
            config: { ...defaultSettings(), automodEnabled: true },
            nextCaseNo: 1,
            nextAppealNo: 1,
        })
        await ctx.db.insert("automodRules", {
            serverId: "10",
            name: "repeat",
            rule: {
                name: "repeat",
                type: "repeat",
                enabled: true,
                priority: 0,
                action: "warn",
                threshold: 3,
                windowSeconds: 300,
                durationSeconds: 900,
                patterns: [],
                domainMode: "block",
                channelIds: [],
                exemptChannelIds: [],
                exemptRoleIds: [],
            },
        })
        // A busy member's 1,000 other messages inside the five-minute window
        for (let index = 0; index < 1000; index++)
            await ctx.db.insert("automodWindows", {
                serverId: "10",
                userId: "20",
                channelId: "30",
                kind: "message",
                contentHash: hash(index + 1),
                timestamp: now - 1000,
                expiresAt: now + 299000,
            })
    })
    const event = (messageId: string) => ({
        serverId: "10",
        messageId,
        createdAt: now,
        event: "create",
        userId: "20",
        channelId: "30",
        roleIds: [],
        content: "same",
        contentHash: hash(5000),
        mentionedUserIds: [],
        mentionedRoleIds: [],
        mentionedEveryone: false,
        targetIsStaff: false,
        context: {
            botId: "999",
            botActionAuthorized: true,
            actorCanManageTarget: true,
            botCanManageTarget: true,
            targetProtected: false,
            currentTimeoutUntil: null,
            botAuthorizedActions: ["log", "warn"],
        },
    })
    const evaluate = (messageId: string) =>
        measure(b, (ctx) => ctx.runMutation(internal.protection.evaluate, { request: event(messageId) }))
    const first = await evaluate("100")
    assert(first.read <= 20, `Evaluation read ${first.read} documents`)
    assert.equal((first.value as { blocked: boolean }).blocked, false)
    await evaluate("101")
    // The third copy reaches the threshold
    const third = await evaluate("102")
    assert(third.read <= 30, `Evaluation read ${third.read} documents`)
    assert.equal((await b.run((ctx) => ctx.db.query("moderationCases").collect())).length, 1)
})

test("A rank is exact for any member in a crowded server and reads about two thousand small count rows", async (t) => {
    serveSingle(t)
    const b = backend(),
        members = 1400
    // 1,000 members spread over many levels, and 400 more tied at 50 XP in level 0
    const xpOf = (index: number) => (index < 1000 ? 100 + ((index * 7919) % 400000) : 50),
        userOf = (index: number) => String(100000 + index)
    // Each profile is counted as awards and corrections count it
    await b.run((ctx) => insertDocument(ctx, "levelingSettings", "10", { profiles: members, countsReady: true }))
    // A transaction is limited in the index ranges it reads, so the members are counted in groups
    for (let first = 0; first < members; first += 300)
        await b.run(async (ctx) => {
            for (let index = first; index < Math.min(members, first + 300); index++) {
                const xp = xpOf(index),
                    counted = await countedProfile(ctx, "10", xp)
                await ctx.db.insert("levelingProfiles", {
                    serverId: "10",
                    userId: userOf(index),
                    xp,
                    scoreEpoch: 1,
                    adjustmentRevision: 0,
                    digests: [],
                    ...counted,
                })
            }
        })
    // The position is one plus the members with more XP, and equal XP shares it
    const above = (xp: number) =>
            Array.from({ length: members }, (_, index) => xpOf(index)).filter((x) => x > xp).length,
        others = (xp: number) =>
            Array.from({ length: members }, (_, index) => xpOf(index)).filter((x) => x === xp).length - 1
    const actor = {
        originServerId: "10",
        userId: "1",
        roleIds: [],
        isOwner: false,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const member = {
        userId: "1",
        joinedAt: "2023-11-14T22:00:00.000000Z",
        roleIds: [],
        isBot: false,
        timeoutUntil: null,
    }
    const rank = async (userId: string) => {
        const measured = await measure(b, (ctx) =>
            ctx.runQuery(internal.leveling.query, {
                request: { serverId: "10", actor, member, observedAt: now, operation: { type: "rank", userId } },
            }),
        )
        return {
            rank: (measured.value as Extract<LevelingQueryResult, { type: "rank" }>).rank,
            read: measured.read,
            bytes: measured.bytes,
        }
    }
    for (const index of [0, 5, 77, 500, 999, 1000, 1399]) {
        const userId = userOf(index),
            measured = await rank(userId)
        assert.deepEqual(
            measured.rank,
            { type: "exact", position: above(xpOf(index)) + 1, tied: others(xpOf(index)) },
            `${userId} read as ${JSON.stringify(measured.rank)}`,
        )
        assert(measured.read <= 2300, `Rank read ${measured.read} documents`)
    }
    // The 400 tied at 50 XP all share the position after the 1,000 above them
    assert.deepEqual((await rank(userOf(1399))).rank, { type: "exact", position: 1001, tied: 399 })
    assert.deepEqual((await rank(userOf(1000))).rank, { type: "exact", position: 1001, tied: 399 })
})
