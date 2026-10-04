import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { MutationCtx } from "../convex/_generated/server.js"
import { internal } from "../convex/_generated/api.js"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { levelForXp } from "../convex/levelingDomain.ts"
import type { LevelingQueryResult, LevelingRank } from "@neonflux/contracts/leveling"
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
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
// Service functions check the configured server, here server 10
function serveSingle(t: TestContext) {
    const scope = process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_ID = "10"
    t.after(() => {
        if (scope === undefined) delete process.env.NEONFLUX_SERVER_ID
        else process.env.NEONFLUX_SERVER_ID = scope
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

test("A rank sums level counts and reads at most 101 profiles, exact or a true range in a crowded level", async (t) => {
    serveSingle(t)
    const b = backend(),
        members = 3400
    // 3,000 members spread over 63 levels and 400 more tied at 50 XP in level 0
    const xpOf = (index: number) => (index < 3000 ? 100 + ((index * 7919) % 400000) : 50),
        userOf = (index: number) => String(100000 + index)
    // Each profile is counted under its level, as awards and corrections count it
    await b.run(async (ctx) => {
        await insertDocument(ctx, "levelingSettings", "10", { profiles: members })
        const counts = new Map<number, number>()
        for (let index = 0; index < members; index++) {
            const xp = xpOf(index),
                level = levelForXp(xp)
            counts.set(level, (counts.get(level) ?? 0) + 1)
            await ctx.db.insert("levelingProfiles", {
                serverId: "10",
                userId: userOf(index),
                xp,
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
                rankLevel: level,
            })
        }
        for (const [level, count] of counts)
            await ctx.db.insert("levelingLevels", { serverId: "10", scoreEpoch: 1, level, count })
    })
    // Positions as the leaderboard orders them, by XP and then account ID, highest first
    const order = Array.from({ length: members }, (_, index) => index).sort(
        (a, c) => xpOf(c) - xpOf(a) || (userOf(c) < userOf(a) ? -1 : 1),
    )
    const expected = new Map(order.map((index, position) => [userOf(index), position + 1]))
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
    const contains = (result: LevelingRank, position: number) =>
        result.type === "exact"
            ? result.position === position
            : result.type === "range" && result.from <= position && position <= result.to
    for (const index of [0, 5, 77, 1500, 2999, 3000, 3399]) {
        const userId = userOf(index),
            measured = await rank(userId)
        assert(
            contains(measured.rank, expected.get(userId)!),
            `${userId} at ${expected.get(userId)} read as ${JSON.stringify(measured.rank)}`,
        )
        assert(measured.read <= 200, `Rank read ${measured.read} documents`)
    }
    // The highest account ID in the tied crowd is exact, and the lowest has 399 tied members above it, so it reads as a range
    assert.deepEqual((await rank(userOf(3399))).rank, { type: "exact", position: 3001 })
    assert.deepEqual((await rank(userOf(3000))).rank, { type: "range", from: 3102, to: 3400 })
})
