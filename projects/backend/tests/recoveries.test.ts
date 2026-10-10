import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { BackupContext, CleanupContext, TicketContext } from "../contracts.js"
import type { MutationCtx } from "../convex/_generated/server.js"
import { backupOwner } from "../convex/backupStore.ts"
import { cleanupAutomation } from "../convex/cleanupStore.ts"
import { memberRecoveries } from "../convex/moderationStore.ts"
import { onboardingProtection } from "../convex/roleClaims.ts"
import { ticketProtection } from "../convex/ticketStore.ts"
import { insertDocument } from "./schema-documents.ts"

// A quarantine recovery whose timeout has ended no longer restricts its member, even before retention deletes it
const start = Date.parse("2026-01-01T00:00:00Z"), deadline = start + 60000
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
// Member 20 of server 10 is quarantined by case 1 until the deadline, which retention has not processed
async function quarantined() {
    const t = convexTest({ schema, modules, transactionLimits: true })
    await t.run(async ctx => {
        await insertDocument(ctx, "moderationCases", "10", { caseNo: 1, action: "quarantine", targetId: "20", expiresAt: start + 86400000 })
        await ctx.db.insert("securityRecoveries", { serverId: "10", generation: 1, type: "timeout", targetId: "20", caseNo: 1, status: "active", createdAt: start, knownDeadline: deadline })
    })
    return t
}
type Backend = Awaited<ReturnType<typeof quarantined>>
// Each reader rejects the member before the deadline and accepts it right after, with the recovery row still stored
async function blocksUntilDeadline(t: Backend, read: (ctx: MutationCtx) => Promise<unknown>, error: RegExp) {
    await assert.rejects(t.run(read), error)
    now = deadline
    await t.run(read)
    assert.equal((await t.run(ctx => ctx.db.query("securityRecoveries").collect())).length, 1)
}

test("The shared recovery read drops elapsed active recoveries, keeps the rest and counts every row for the limit", async () => {
    const t = await quarantined()
    await t.run(async ctx => {
        await ctx.db.insert("securityRecoveries", { serverId: "10", generation: 2, type: "timeout", targetId: "20", caseNo: 2, status: "pending", createdAt: start })
        await ctx.db.insert("securityRecoveries", { serverId: "10", generation: 3, type: "ban", targetId: "20", caseNo: 3, status: "uncertain", createdAt: start, knownDeadline: start })
    })
    const read = () => t.run(async ctx => { const result = await memberRecoveries(ctx, "10", "20"); return { count: result.count, cases: result.cases.map(row => row?.caseNo ?? null) } })
    assert.deepEqual(await read(), { count: 3, cases: [1, null, null] })
    now = deadline
    // Only an active recovery past its deadline is dropped. Pending and uncertain recoveries still count as restrictions
    assert.deepEqual(await read(), { count: 3, cases: [null, null] })
    await t.run(async ctx => { for (let generation = 4; generation <= 11; generation++) await ctx.db.insert("securityRecoveries", { serverId: "10", generation, type: "timeout", targetId: "20", caseNo: generation, status: "active", createdAt: start, knownDeadline: start }) })
    assert.equal((await read()).count, 11)
})

test("Role participation and leveling ignore an ended quarantine", async () => {
    await blocksUntilDeadline(await quarantined(), ctx => onboardingProtection(ctx, "10", "20", null), /Quarantine blocks role participation/)
})

test("Tickets ignore an ended quarantine", async () => {
    const context = { actor: { userId: "20", timeoutUntil: null } } as unknown as TicketContext
    await blocksUntilDeadline(await quarantined(), ctx => ticketProtection(ctx, "10", context), /Ticket member restricted/)
})

test("Message cleanup ignores an ended quarantine", async () => {
    const context = { channelId: "30", botAuthorized: true, botKind: "bot", botMember: { userId: "20", isBot: true, canView: true, canReadHistory: true, timeoutUntil: null } } as unknown as CleanupContext
    await blocksUntilDeadline(await quarantined(), ctx => cleanupAutomation(ctx, "10", context, "30"), /Quarantine blocks cleanup/)
})

test("Backup restore ignores an ended quarantine", async () => {
    const context = { ownerId: "20", botId: "999" } as unknown as BackupContext
    await blocksUntilDeadline(await quarantined(), ctx => backupOwner(ctx, "10", context), /Backup participant quarantined/)
})
