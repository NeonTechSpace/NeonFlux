import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { DashboardPrivateResult, DashboardPrivateView } from "../dashboard-contracts.js"
import { PRIVATE_ACCESS_MS, PRIVATE_CHECK_INTERVAL_MS, PRIVATE_CHECK_MS } from "../convex/privateData.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { botCall } from "./bot-service.ts"

const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
// The signed-in user 20 manages server 10 unless a test makes them an ordinary member. The owner is 99
let permissions = "32"
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-private-data-secret-0000000000000000"
    now = start
    permissions = "32"
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Viewer", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions }])
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
const owner = { originServerId: "10", userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const administrator = { ...owner, userId: "20", isOwner: false, isAdministrator: true }
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
async function fixture() {
    const t = backend()
    const session = await t.action(api.dashboard.admit, { accessToken: "synthetic-private-provider-token" })
    const args = { sessionToken: session.sessionToken, serverId: "10" }
    const view = (selected: DashboardPrivateView = { type: "cases" }): Promise<DashboardPrivateResult> => t.mutation(api.privateData.view, { ...args, view: selected })
    const ready = async () => (await (await botCall(t, "/private-data/ready", { serverId: "10" })).json() as { checks: unknown[] }).checks
    const record = async (answer: Record<string, unknown>) => await (await botCall(t, "/private-data/record", { serverId: "10", userId: "20", ...answer })).json() as unknown
    const audit = async () => (await t.query(api.auditLog.page, { ...args, cursor: null })).entries
    return { t, session, args, view, ready, record, audit }
}
const setRole = (t: Backend, roleId: string | undefined) => t.run(async ctx => {
    const row = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", "10")).unique()
    if (row) await ctx.db.patch(row._id, { privateDataRoleId: roleId })
    else await ctx.db.insert("moderationSettings", { serverId: "10", config: defaultSettings(), nextCaseNo: 1, nextAppealNo: 1, ...roleId ? { privateDataRoleId: roleId } : {} })
})
const member = (roleIds: string[]) => ({ originServerId: "10", isOwner: false, present: true, roleIds })

test("Only the server owner sets the private data role, from a command or the website, and both changes reach the audit log", async () => {
    const { t, args, audit } = await fixture()
    const manage = (actor: typeof owner, roleId: string | null, messageId: string) =>
        botCall(t, "/moderation/manage", { serverId: "10", messageId, createdAt: now, actor, operation: { type: "private-role", roleId } })
    assert.equal((await manage(administrator, "40", "1001")).status, 403)
    assert.equal((await manage(owner, "10", "1002")).status, 400)
    assert.deepEqual(await (await manage(owner, "40", "1003")).json(), { duplicate: false, type: "private-role", roleId: "40" })
    const snapshot = await t.query(api.dashboardConfiguration.snapshot, { ...args, family: "moderation" })
    assert.equal(snapshot.family === "moderation" && snapshot.data.privateDataRoleId, "40")

    const job = await t.action(api.dashboardConfiguration.queue, { ...args, family: "moderation", operation: { type: "private-role", roleId: null }, expectedConfigRevision: 1, requestId: "00000000-0000-4000-8000-000000000001" })
    const execute = (actor: typeof owner) => botCall(t, "/dashboard-configuration/execute", { serverId: "10", originServerId: "10", jobId: job.jobId, actorId: "20", managerAuthorized: true, observedAt: now, actor })
    // The bot's fresh read shows the manager is an Administrator but not the owner
    assert.equal((await execute(administrator)).status, 403)
    assert.equal((await execute({ ...administrator, isOwner: true })).status, 200)
    assert.equal(await t.run(async ctx => (await ctx.db.query("moderationSettings").first())?.privateDataRoleId ?? null), null)
    assert.deepEqual((await audit()).map(({ source, feature, setting, summary }) => ({ source, feature, setting, summary })), [
        { source: "website", feature: "moderation", setting: "private-role", summary: "privateDataRoleId: 40 → none" },
        { source: "command", feature: "moderation", setting: "private-role", summary: "privateDataRoleId: none → 40" },
    ])
})

test("Each view needs a live check: an Administrator without the role is refused, a role holder passes, and a removed role stops access at the next check", async () => {
    const { t, view, ready, record } = await fixture()
    await setRole(t, "40")
    assert.deepEqual(await view(), { status: "checking" })
    // The website's request wakes the server's dashboard worker, and a second view waits for the same check
    assert.deepEqual((await (await botCall(t, "/service/work", { cursor: null })).json() as { kinds: { dashboard: string[] } }).kinds.dashboard, ["10"])
    assert.deepEqual(await view(), { status: "checking" })
    assert.deepEqual(await ready(), [{ userId: "20" }])
    // The bot reports only ownership, membership and roles, so a permission such as Administrator cannot count
    assert.equal((await botCall(t, "/private-data/record", { serverId: "10", userId: "20", ...member(["41"]), isAdministrator: true })).status, 400)
    assert.equal((await botCall(t, "/private-data/record", { serverId: "10", userId: "20", ...member(["41"]), originServerId: "11" })).status, 403)
    assert.deepEqual(await record(member(["41"])), { recorded: true })
    assert.deepEqual(await view(), { status: "refused" })
    assert.deepEqual(await ready(), [])

    // A refused viewer waits before the bot checks again
    now += PRIVATE_CHECK_INTERVAL_MS - 1
    assert.deepEqual(await view(), { status: "refused" })
    now += 1
    assert.deepEqual(await view(), { status: "checking" })
    await record(member(["41", "40"]))
    assert.equal((await view()).status, "ok")
    // Paging within the window reuses the passed check
    now += PRIVATE_ACCESS_MS - 1
    assert.equal((await view({ type: "appeals" })).status, "ok")
    assert.deepEqual(await ready(), [])
    // After the window the next view starts a new check, and the removed role refuses it
    now += 1
    assert.deepEqual(await view(), { status: "checking" })
    await record(member(["41"]))
    assert.deepEqual(await view(), { status: "refused" })
    // A member who left is refused too
    now += PRIVATE_CHECK_INTERVAL_MS
    await view()
    await record({ originServerId: "10", isOwner: false, present: false, roleIds: [] })
    assert.deepEqual(await view(), { status: "refused" })
})

test("The owner always passes, even without a private data role, and a viewer without the role is refused", async () => {
    const { t, args, view, record } = await fixture()
    assert.deepEqual((await t.query(api.privateData.access, args)).roleConfigured, false)
    assert.deepEqual(await view(), { status: "checking" })
    await record({ originServerId: "10", isOwner: true, present: true, roleIds: [] })
    assert.equal((await view()).status, "ok")
    now += PRIVATE_ACCESS_MS
    await view()
    await record(member(["40"]))
    assert.deepEqual(await view(), { status: "refused" })
})

test("A check the bot does not answer in time fails, its late answer is dropped and its row is deleted when its window ends", async () => {
    const { t, args, view, record } = await fixture()
    await setRole(t, "40")
    await view()
    now += PRIVATE_CHECK_MS
    await t.finishAllScheduledFunctions(() => mock.timers.tick(PRIVATE_CHECK_MS))
    assert.deepEqual((await t.query(api.privateData.access, args)).check, { state: "failed", requestedAt: start })
    assert.deepEqual(await record(member(["40"])), { recorded: false })
    // A new check may start at once, since the failed one is older than the interval
    assert.deepEqual(await view(), { status: "checking" })
    await record(member(["40"]))
    assert.deepEqual((await t.query(api.privateData.access, args)).check, { state: "passed", requestedAt: now, checkedAt: now, validUntil: now + PRIVATE_ACCESS_MS })
    now += PRIVATE_CHECK_MS + PRIVATE_ACCESS_MS
    await t.mutation(internal.privateData.cleanup, { serverId: "10", userId: "20" })
    assert.equal((await t.query(api.privateData.access, args)).check, null)
})

test("Views list cases and appeals newest first in pages, open a case with its corrections and appeals, show a member's history, keep erasures and record each view without content", async () => {
    const { t, view, record, audit } = await fixture()
    await setRole(t, "40")
    await t.run(async ctx => {
        for (let caseNo = 1; caseNo <= 27; caseNo++) await ctx.db.insert("moderationCases", { serverId: "10", caseNo, sourceId: String(1000 + caseNo), action: "warn", origin: "manual",
            actorId: "99", targetId: caseNo % 2 ? "21" : "22", reason: `Synthetic private reason ${caseNo}`, createdAt: start + caseNo, expiresAt: start + 86400000, outcome: "succeeded",
            logOutcome: "none", notificationOutcome: "none", erased: false, voided: false, blocksPublic: false, correctionCount: 0 })
        for (let appealNo = 1; appealNo <= 3; appealNo++) await ctx.db.insert("moderationAppeals", { serverId: "10", appealNo, caseNo: appealNo === 3 ? 5 : 3, userId: "21",
            text: `Synthetic appeal text ${appealNo}`, createdAt: start + appealNo, status: "open", erased: false })
    })
    // A correction and the owner's erasure go through the chat paths
    const manage = (operation: unknown, messageId: string) => botCall(t, "/moderation/manage", { serverId: "10", messageId, createdAt: now, actor: owner, operation })
    assert.equal((await manage({ type: "case-reason", caseNo: 3, reason: "Synthetic corrected reason" }, "2001")).status, 200)
    assert.equal((await manage({ type: "erase", caseNo: 5 }, "2002")).status, 200)
    await view()
    await record(member(["40"]))

    const first = await view()
    assert.ok(first.status === "ok" && first.data.type === "cases")
    assert.deepEqual([first.data.cases.map(row => row.caseNo).slice(0, 3), first.data.cases.length, first.data.nextBeforeCaseNo], [[27, 26, 25], 25, 3])
    const second = await view({ type: "cases", beforeCaseNo: 3 })
    assert.ok(second.status === "ok" && second.data.type === "cases")
    assert.deepEqual([second.data.cases.map(row => row.caseNo), second.data.nextBeforeCaseNo], [[2, 1], undefined])

    const corrected = await view({ type: "case", caseNo: 3 })
    assert.ok(corrected.status === "ok" && corrected.data.type === "case")
    assert.deepEqual(corrected.data.case.corrections.map(({ previousReason, reason, type }) => ({ previousReason, reason, type })),
        [{ previousReason: "Synthetic private reason 3", reason: "Synthetic corrected reason", type: "reason" }])
    assert.deepEqual(corrected.data.appeals.map(row => row.appealNo), [2, 1])
    // An erased case and its appeal keep only the erasure marker
    const erased = await view({ type: "case", caseNo: 5 })
    assert.ok(erased.status === "ok" && erased.data.type === "case")
    assert.deepEqual([erased.data.case.erased, erased.data.case.corrections, erased.data.appeals.map(row => row.erased)], [true, [], [true]])
    assert.ok(!JSON.stringify(erased).includes("Synthetic private reason 5") && !JSON.stringify(erased).includes("Synthetic appeal text 3"))
    await assert.rejects(view({ type: "case", caseNo: 99 }))

    const appeals = await view({ type: "appeals" })
    assert.ok(appeals.status === "ok" && appeals.data.type === "appeals")
    assert.deepEqual(appeals.data.appeals.map(row => row.appealNo), [3, 2, 1])
    const history = await view({ type: "history", userId: "22" })
    assert.ok(history.status === "ok" && history.data.type === "history")
    assert.deepEqual([history.data.cases.map(row => row.caseNo).slice(0, 2), history.data.cases.length, history.data.appeals], [[26, 24], 13, []])

    const views = (await audit()).filter(entry => entry.kind === "private-data-viewed").map(({ actorId, actorName, source, feature, setting, summary }) => ({ actorId, actorName, source, feature, setting, summary }))
    const viewer = { actorId: "20", actorName: "Viewer", source: "website", feature: "private-data" }
    assert.deepEqual(views, [
        { ...viewer, setting: "Member history", summary: "Member 22" },
        { ...viewer, setting: "Appeals list", summary: "Newest appeals" },
        { ...viewer, setting: "Case 5", summary: "Member 21" },
        { ...viewer, setting: "Case 3", summary: "Member 21" },
        { ...viewer, setting: "Cases list", summary: "Cases before case 3" },
        { ...viewer, setting: "Cases list", summary: "Newest cases" },
    ])
    assert.ok(!JSON.stringify(await audit()).includes("Synthetic"))
})

test("A member without Manage Server reaches private cases only while the server names a private data role, and no manager view", async () => {
    permissions = "0"
    const t = backend()
    const admit = () => t.action(api.dashboard.admit, { accessToken: "synthetic-private-provider-token" })
    assert.deepEqual((await admit()).memberServers, [])
    await setRole(t, "40")
    const session = await admit()
    assert.deepEqual([session.servers, session.memberServers], [[], [{ id: "10", name: "Synthetic server", icon: null, features: ["private"] }]])
    const args = { sessionToken: session.sessionToken, serverId: "10" }
    assert.deepEqual(await t.query(api.privateData.access, args), { serverId: "10", roleConfigured: true, check: null })
    assert.deepEqual(await t.mutation(api.privateData.view, { ...args, view: { type: "cases" } }), { status: "checking" })
    for (const denied of [() => t.query(api.dashboardViews.overview, args), () => t.query(api.auditLog.page, { ...args, cursor: null }), () => t.query(api.rolePicker.member, args),
        () => t.query(api.dashboardConfiguration.snapshot, { ...args, family: "moderation" })]) await assert.rejects(denied())
    await setRole(t, undefined)
    await assert.rejects(t.query(api.privateData.access, args), /Private cases unavailable/)
})
