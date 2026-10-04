import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { MutationCtx } from "../convex/_generated/server.js"
import { internal } from "../convex/_generated/api.js"
import { defaultSettings } from "../convex/moderationDomain.ts"

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
