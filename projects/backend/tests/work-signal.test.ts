import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import schema from "../convex/schema.ts"
import { tokenHash } from "../convex/dashboard.ts"
import { LEVELING_DEFER } from "../convex/levelingDomain.ts"
import { rowDueAt } from "../convex/workDispatch.ts"
import type { ServiceWork } from "@neonflux/contracts/service"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"

const secret = "synthetic-work-signal-secret-not-a-credential-0"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const start = Date.parse("2026-06-01T12:00:00Z")
function fixture(tc: TestContext) {
    let now = start
    tc.mock.method(Date, "now", () => now)
    // Sessions and jobs schedule their expiry. Controlled timers keep those runs from holding the process open
    tc.mock.timers.enable({ apis: ["setTimeout"] })
    const t = convexTest({ schema, modules, transactionLimits: true })
    return { t, now: () => now, advance: (milliseconds: number) => { now += milliseconds } }
}
const signal = async (t: ReturnType<typeof convexTest>) => {
    const response = await botCall(t, "/service/work-signal", {})
    assert.equal(response.status, 200)
    return await response.json() as { version: number }
}
const owner = { originServerId: "10", userId: "30", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }

test("Website writes that create bot work ring the signal, which shows only a counter behind the key", async tc => {
    const { t } = fixture(tc), sessionToken = "b".repeat(64)
    assert.deepEqual(await signal(t), { version: 0 })
    assert.equal((await botCall(t, "/service/work-signal", {}, { secret: null })).status, 401)
    await t.mutation(makeFunctionReference<"mutation">("dashboard:store"), { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-provider-token",
        user: { id: "20", name: "Manager" }, servers: [{ id: "10", name: "Synthetic", icon: null }] })
    const save = (expectedRevision: number, prefix: string) => t.mutation(makeFunctionReference<"mutation">("dashboard:apply"), { sessionToken, serverId: "10", section: "general", expectedRevision, prefix })
    // A saved prefix leaves a settings log record for the bot. A stale save changes nothing and rings nothing
    assert.deepEqual(await save(0, "?"), { saved: true, revision: 1 })
    assert.deepEqual(await signal(t), { version: 1 })
    assert.deepEqual(await save(0, "$"), { saved: false, conflict: true, revision: 1 })
    assert.deepEqual(await signal(t), { version: 1 })
    // A queued dashboard job rings once. Repeating the same request queues nothing new
    const queue = () => t.mutation(makeFunctionReference<"mutation">("dashboardConfiguration:enqueue"), { sessionToken, serverId: "10", family: "nickname",
        operation: { type: "set", nickname: "Neon" }, expectedConfigRevision: 0, requestId: "00000000-0000-4000-8000-000000000001" })
    assert.equal((await queue()).queued, true)
    assert.deepEqual(await signal(t), { version: 2 })
    assert.equal((await queue()).queued, true)
    assert.deepEqual(await signal(t), { version: 2 })
})

test("Bot mutations report when the work their writes create becomes due, by the backend clock", async tc => {
    const { t, advance } = fixture(tc)
    const dueIn = (response: Response) => response.headers.get("X-Due-In")
    // Writes that create no dispatcher work report nothing
    const away = await botCall(t, "/afk/set", { serverId: "10", userId: "30", reason: "Away" })
    assert.equal(away.status, 200)
    assert.equal(dueIn(away), null)
    // A correction marks the account for reward work now, through an insert and then a patch
    const adjust = (messageId: string, xp: number) => botCall(t, "/levels/manage", { serverId: "10", messageId, createdAt: start, actor: owner,
        operation: { type: "adjust", userId: "40", xp, reason: "Synthetic correction" } })
    for (const [messageId, xp] of [["50", 100], ["51", 200]] as const) {
        const response = await adjust(messageId, xp)
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
        assert.equal(dueIn(response), "0")
    }
    const list = await (await botCall(t, "/levels/work", { serverId: "10", operation: { type: "list" } })).json() as { accounts: { userId: string, mark: number }[] }
    assert.equal(list.accounts.length, 1)
    // An unfinished pass defers the account, so the answer names the deferral instead of now
    const deferred = await botCall(t, "/levels/work", { serverId: "10", operation: { type: "done", userId: "40", mark: list.accounts[0]!.mark, complete: false } })
    assert.equal(deferred.status, 200)
    assert.equal(dueIn(deferred), String(LEVELING_DEFER))
    // The dispatch agrees: nothing is due now and the next row is due when the deferral ends
    const work = async () => await (await botCall(t, "/service/work", { cursor: null, requestedAt: 1 })).json() as ServiceWork
    assert.deepEqual([(await work()).kinds.levels, (await work()).nextDueIn], [[], LEVELING_DEFER])
    advance(LEVELING_DEFER - 1000)
    assert.deepEqual([(await work()).kinds.levels, (await work()).nextDueIn], [[], 1000])
    advance(1000)
    assert.deepEqual([(await work()).kinds.levels, (await work()).nextDueIn], [["10"], null])
})

test("The next due time is the earliest future row of any timed source and ignores rows its source would not read", async tc => {
    const { t, advance } = fixture(tc)
    await t.run(async ctx => {
        await insertDocument(ctx, "scheduleDeliveries", "10", { active: true, dueAt: start + 90000, nextCheckAt: start + 90000 })
        await insertDocument(ctx, "scheduleDeliveries", "10", { active: false, dueAt: start + 10000, nextCheckAt: start + 10000 })
        await insertDocument(ctx, "eventDeliveries", "10", { state: "queued", dueAt: start + 30000, nextCheckAt: start + 30000, startsAt: start + 3600000 })
        await insertDocument(ctx, "metadataLogRecords", "10", { actionable: false, nextCheckAt: start + 5000 })
    })
    const work = async () => await (await botCall(t, "/service/work", { cursor: null, requestedAt: 1 })).json() as ServiceWork
    assert.equal((await work()).nextDueIn, 30000)
    advance(30000)
    const due = await work()
    assert.deepEqual([due.kinds.events, due.nextDueIn], [["10"], 60000])
    // The same rules decide which written rows a mutation reports
    assert.equal(rowDueAt("scheduleDeliveries", { active: true, dueAt: 7 }, 1), 7)
    assert.equal(rowDueAt("scheduleDeliveries", { active: false, dueAt: 7 }, 1), undefined)
    assert.equal(rowDueAt("levelingProfiles", { rewardDueAt: undefined }, 1), undefined)
    assert.equal(rowDueAt("dashboardConfigurationJobs", { state: "queued", createdAt: 0 }, 5), 5)
    assert.equal(rowDueAt("afkStatuses", { serverId: "10" }, 5), undefined)
})
