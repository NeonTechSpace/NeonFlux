import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import type { BackupContext, ServerExportFile, ServerExportPage } from "../contracts.js"
import { PRIVATE_ACCESS_MS } from "../convex/privateData.ts"
import { EXPORT_APPEALS, EXPORT_CASES, EXPORT_LEVELS } from "../convex/serverExport.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { botCall } from "./bot-service.ts"

const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
// The signed-in user 20 manages server 10. The bot's check decides whether they own it
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-server-export-secret-000000000000000"
    now = start
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Owner", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Synthetic server", owner_id: "20", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
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
const context = (patch: Partial<BackupContext> = {}): BackupContext => ({ originServerId: "10", provider: "https://api.example.test", observedAt: now, ownerId: "20", actorId: "20", actorKind: "human", botId: "999", botKind: "bot",
    ownerJoinedAt: "2024-01-01T00:00:00.000Z", ownerTimeoutUntil: null, botTimeoutUntil: null, dmChannelId: "90", dmType: 1, recipientIds: ["20"], privateReplyAuthorized: true, ...patch })

// Assembles pages the way both readers do: Lists continue, and a later page of a family continues only the lists it carries
function assemble(pages: ServerExportPage[]) {
    const file: Pick<ServerExportFile, "settings" | "levels" | "showcases" | "profiles" | "cases" | "appeals"> = { settings: {}, levels: [], showcases: [], profiles: [], cases: [], appeals: [] }
    for (const page of pages) {
        if (page.section === "levels") file.levels.push(...page.levels)
        else if (page.section === "showcases") file.showcases.push(...page.showcases)
        else if (page.section === "profiles") file.profiles.push(...page.profiles)
        else if (page.section === "cases") file.cases.push(...page.cases)
        else if (page.section === "appeals") file.appeals.push(...page.appeals)
        else if (!file.settings[page.family]) file.settings[page.family] = page.data
        else for (const [key, value] of Object.entries(page.data)) file.settings[page.family]![key] = [...file.settings[page.family]![key] as unknown[], ...value as unknown[]]
    }
    return file
}
async function seed(t: ReturnType<typeof backend>) {
    await t.run(async ctx => {
        await ctx.db.insert("moderationSettings", { serverId: "10", config: defaultSettings(), nextCaseNo: 106, nextAppealNo: 3 })
        // More watchlist entries than one dashboard page holds, so the moderation family takes two pages
        for (let i = 0; i < 25; i++) await ctx.db.insert("securityWatchlist", { serverId: "10", userId: String(5000 + i), reason: `Synthetic watch reason ${i}`, createdAt: start })
        for (let i = 0; i < EXPORT_LEVELS + 1; i++) await ctx.db.insert("levelingProfiles", { serverId: "10", userId: String(100000 + i), xp: 400 + i, scoreEpoch: 1, adjustmentRevision: 0, digests: [] })
        // A profile from an earlier season has no current XP
        await ctx.db.insert("levelingProfiles", { serverId: "10", userId: "200000", xp: 9000, scoreEpoch: 0, adjustmentRevision: 0, digests: [] })
        for (let caseNo = 1; caseNo <= EXPORT_CASES + 5; caseNo++) {
            const erased = caseNo === 5
            const id = await ctx.db.insert("moderationCases", { serverId: "10", caseNo, sourceId: String(1000 + caseNo), action: "warn", origin: "manual", actorId: "99", targetId: "21",
                reason: erased ? "[Erased by owner]" : `Synthetic private reason ${caseNo}`, createdAt: start + caseNo, expiresAt: start + 86400000, outcome: "succeeded",
                logOutcome: "none", notificationOutcome: "none", erased, voided: false, blocksPublic: false, correctionCount: caseNo === 3 ? 1 : 0 })
            if (caseNo === 3) await ctx.db.insert("moderationCorrections", { caseId: id, actorId: "99", createdAt: start + 50, previousReason: "Synthetic first reason", reason: "Synthetic private reason 3", type: "reason" })
        }
        await ctx.db.insert("moderationAppeals", { serverId: "10", appealNo: 1, caseNo: 3, userId: "21", text: "Synthetic appeal text", createdAt: start + 7, status: "rejected", decisionReason: "Synthetic decision", decidedAt: start + 8, decidedBy: "99", erased: false })
        await ctx.db.insert("moderationAppeals", { serverId: "10", appealNo: 2, caseNo: 5, userId: "21", text: "[Erased by owner]", createdAt: start + 9, status: "rejected", decisionReason: "[Erased by owner]", erased: true })
        // A posted showcase and a profile, with member text as stored
        const content = { content: "", embed: { title: "Synthetic game" } }
        const attemptId = await ctx.db.insert("publishingAttempts", { serverId: "10", postNo: 1, generation: 1, sourceId: "showcase_job", actorId: "999", botId: "999", channelId: "40", action: "send", messageId: "500",
            content, canonicalContent: content, dispatchExpiresAt: start + 1, nativeDeadlineMs: 5000, outcome: "sent", unresolved: false, createdAt: start })
        await ctx.db.insert("publishingPosts", { serverId: "10", postNo: 1, generation: 1, channelId: "40", botId: "999", messageId: "500", outcome: "sent", createdAt: start, updatedAt: start, attemptId })
        await ctx.db.insert("showcases", { serverId: "10", showcaseNo: 1, authorId: "21", title: "Synthetic game <@22>", text: "Synthetic text", links: ["https://example.org/"], channelId: "40", postNo: 1, attemptId, createdAt: start, updatedAt: start })
        await ctx.db.insert("profiles", { serverId: "10", userId: "21", bio: "Synthetic bio", links: [], color: 255, updatedAt: start })
    })
}

test("The owner's DM export reads every settings family, leveling, cases and appeals in bounded pages, leaves erased text out and records the export", async () => {
    const t = backend()
    await seed(t)
    // Only the current owner, asking in a one-to-one DM, may export
    assert.equal((await botCall(t, "/export/start", { serverId: "10", context: context({ actorId: "21" }) })).status, 403)
    assert.equal((await botCall(t, "/export/page", { serverId: "10", context: context({ recipientIds: ["20", "21"] }), cursor: null })).status, 403)
    assert.deepEqual(await (await botCall(t, "/export/start", { serverId: "10", context: context() })).json(), { version: 1 })

    const pages: ServerExportPage[] = []
    let cursor: string | null = null
    do {
        const response = await botCall(t, "/export/page", { serverId: "10", context: context(), cursor })
        assert.equal(response.status, 200)
        const page = await response.json() as ServerExportPage
        pages.push(page)
        cursor = page.cursor
    } while (cursor)
    for (const page of pages) {
        if (page.section === "levels") assert.ok(page.levels.length <= EXPORT_LEVELS)
        if (page.section === "cases") assert.ok(page.cases.length <= EXPORT_CASES)
        if (page.section === "appeals") assert.ok(page.appeals.length <= EXPORT_APPEALS)
    }
    const file = assemble(pages)
    assert.deepEqual(Object.keys(file.settings), ["general", "analytics", "roles", "logs", "responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions",
        "cleanup", "events", "schedules", "voice", "rolepicker", "temproles", "sticky", "sidebar", "alerts", "helpdesk", "onboarding", "lfg", "showcase", "profile"])
    assert.deepEqual(file.settings.general, { prefix: "!", nickname: null })
    // The second moderation page continues the watchlist without repeating the first page's lists
    const watchlist = file.settings.moderation!.watchlist as Array<{ userId: string }>
    assert.deepEqual([watchlist.length, new Set(watchlist.map(row => row.userId)).size], [25, 25])
    assert.deepEqual(file.settings.moderation!.rules, [])
    // Live state in a family's view is not a setting
    assert.deepEqual(Object.keys(file.settings.voice!), ["generators"])
    assert.deepEqual(Object.keys(file.settings.temproles!), ["settings"])
    assert.deepEqual(Object.keys(file.settings.lfg!), ["settings"])

    assert.equal(file.levels.length, EXPORT_LEVELS + 1)
    assert.deepEqual(file.levels[0], { userId: "100000", xp: 400, level: 2 })
    assert.ok(!file.levels.some(row => row.userId === "200000"))

    assert.deepEqual(file.showcases, [{ showcaseNo: 1, authorId: "21", title: "Synthetic game <@22>", text: "Synthetic text", links: ["https://example.org/"], channelId: "40", messageId: "500", createdAt: start, updatedAt: start }])
    assert.deepEqual(file.profiles, [{ userId: "21", bio: "Synthetic bio", links: [], color: 255, updatedAt: start }])
    assert.equal(file.cases.length, EXPORT_CASES + 5)
    assert.deepEqual(file.cases[2]!.corrections, [{ type: "reason", actorId: "99", previousReason: "Synthetic first reason", reason: "Synthetic private reason 3", createdAt: start + 50 }])
    assert.deepEqual([file.cases[4]!.erased, file.cases[4]!.reason], [true, null])
    assert.deepEqual(file.appeals, [
        { appealNo: 1, caseNo: 3, userId: "21", status: "rejected", text: "Synthetic appeal text", decisionReason: "Synthetic decision", decidedBy: "99", decidedAt: start + 8, erased: false, createdAt: start + 7 },
        { appealNo: 2, caseNo: 5, userId: "21", status: "rejected", text: null, decisionReason: null, erased: true, createdAt: start + 9 },
    ])
    assert.ok(!JSON.stringify(file).includes("Erased by owner"))

    const entries = await t.run(ctx => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(entries.map(({ kind, source, actorId, feature, setting, summary }) => ({ kind, source, actorId, feature, setting, summary })),
        [{ kind: "server-exported", source: "command", actorId: "20", feature: "export", setting: "Server export", summary: "Started a readable export, format version 1" }])
    assert.equal((await botCall(t, "/export/page", { serverId: "10", context: context(), cursor: "nf-export-v1:{\"part\":999}" })).status, 400)
})

test("A website export starts only after the bot's check finds the owner, reads pages while that check is fresh and continues after a new check", async () => {
    const t = backend()
    await seed(t)
    const session = await t.action(api.dashboard.admit, { accessToken: "synthetic-export-provider-token" })
    const args = { sessionToken: session.sessionToken, serverId: "10" }
    const begin = (resume?: boolean) => t.mutation(api.serverExport.start, { ...args, ...resume ? { resume } : {} })
    const page = (cursor: string | null = null) => t.query(api.serverExport.page, { ...args, cursor })
    const answer = (isOwner: boolean) => botCall(t, "/private-data/record", { serverId: "10", userId: "20", originServerId: "10", isOwner, present: true, roleIds: ["40"] })
    const exports = async () => (await t.query(api.auditLog.page, { ...args, cursor: null })).entries.filter(entry => entry.kind === "server-exported").map(entry => [entry.source, entry.actorName, entry.summary])

    assert.deepEqual(await begin(), { status: "checking" })
    assert.deepEqual(await page(), { status: "expired" })
    // A member with the private data role passes the private cases check but is not the owner
    await t.run(async ctx => { const row = (await ctx.db.query("moderationSettings").first())!; await ctx.db.patch(row._id, { privateDataRoleId: "40" }) })
    await answer(false)
    assert.deepEqual(await begin(), { status: "refused" })
    assert.deepEqual(await page(), { status: "expired" })
    assert.deepEqual(await exports(), [])

    now += PRIVATE_ACCESS_MS
    assert.deepEqual(await begin(), { status: "checking" })
    await answer(true)
    assert.deepEqual(await begin(), { status: "ok" })
    const first = await page()
    assert.ok(first.status === "ok" && first.page.section === "settings" && first.page.family === "general" && first.page.cursor)
    now += PRIVATE_ACCESS_MS
    assert.deepEqual(await page(first.page.cursor), { status: "expired" })
    assert.deepEqual(await begin(true), { status: "checking" })
    await answer(true)
    assert.deepEqual(await begin(true), { status: "ok" })
    const second = await page(first.page.cursor)
    assert.ok(second.status === "ok" && second.page.section === "settings" && second.page.family === "analytics")
    assert.deepEqual(await exports(), [["website", "Owner", "Continued after a new access check"], ["website", "Owner", "Started a readable export, format version 1"]])
})
