import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import { tokenHash } from "../convex/dashboard.ts"
import { SETUP_CHECK_INTERVAL_MS, SETUP_CHECK_MS } from "../convex/setupCheck.ts"
import { botCall } from "./bot-service.ts"

const modules = {
    "../convex/setupCheck.ts": () => import("../convex/setupCheck.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
let now = Date.parse("2026-10-01T00:00:00Z")
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-setup-check-secret-000000000000"
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})
const backend = () => convexTest({ schema, modules, transactionLimits: true })
// A manager's dashboard session for server 10, as admission stores it
async function session(t: ReturnType<typeof backend>) {
    const sessionToken = "a".repeat(64)
    await t.run(async ctx => { await ctx.db.insert("dashboardSessions", { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-sealed-token", userId: "20", userName: "Synthetic manager",
        servers: [{ id: "10", name: "Synthetic server" }], expiresAt: now + 3600000, lifetimeAt: now + 86400000 }) })
    return { sessionToken, serverId: "10" }
}
const problem = { kind: "permissions", feature: "moderation", permissions: ["KickMembers"] }

test("the website asks the bot for a permission check, the bot answers once and the dashboard reads the answer", async () => {
    const t = backend(), args = await session(t)
    assert.equal(await t.query(api.setupCheck.view, args), null)
    await t.mutation(api.setupCheck.request, args)
    assert.deepEqual(await t.query(api.setupCheck.view, args), { serverId: "10", state: "queued", requestedAt: now, problems: [] })
    // The work dispatcher wakes the server's dashboard worker for it
    assert.deepEqual((await (await botCall(t, "/service/work", { cursor: null })).json() as { kinds: { dashboard: string[] } }).kinds.dashboard, ["10"])
    assert.deepEqual(await (await botCall(t, "/setup/ready", { serverId: "10" })).json(), { queued: true })
    assert.equal((await botCall(t, "/setup/record", { serverId: "10", problems: [{ kind: "permissions", feature: "moderation", permissions: ["Kick Members"] }] })).status, 400)
    assert.deepEqual(await (await botCall(t, "/setup/record", { serverId: "10", problems: [problem] })).json(), { recorded: true })
    assert.deepEqual(await (await botCall(t, "/setup/record", { serverId: "10", problems: [] })).json(), { recorded: false })
    assert.deepEqual(await t.query(api.setupCheck.view, args), { serverId: "10", state: "done", requestedAt: now, checkedAt: now, problems: [problem] })
    // A refresh right after a check is ignored, so the button cannot keep the bot reading Fluxer
    now += SETUP_CHECK_INTERVAL_MS - 1
    await t.mutation(api.setupCheck.request, args)
    assert.equal((await t.query(api.setupCheck.view, args))?.state, "done")
    now += 1
    await t.mutation(api.setupCheck.request, args)
    assert.equal((await t.query(api.setupCheck.view, args))?.state, "queued")
    await assert.rejects(t.query(api.setupCheck.view, { ...args, serverId: "11" }))
})

test("a check the bot does not answer in time fails, and its late answer is dropped", async () => {
    const t = backend(), args = await session(t)
    await t.mutation(api.setupCheck.request, args)
    now += SETUP_CHECK_MS
    await t.finishAllScheduledFunctions(() => mock.timers.tick(SETUP_CHECK_MS))
    assert.equal((await t.query(api.setupCheck.view, args))?.state, "failed")
    assert.deepEqual(await (await botCall(t, "/setup/ready", { serverId: "10" })).json(), { queued: false })
    assert.deepEqual(await (await botCall(t, "/setup/record", { serverId: "10", problems: [problem] })).json(), { recorded: false })
})

test("the bot reads every feature's state and the roles each enabled feature assigns", async () => {
    const t = backend()
    await t.run(async ctx => {
        await ctx.db.insert("roleSettings", { serverId: "10", config: { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: true, humansOnly: true, autoroleIds: ["40"],
            reservations: [{ userId: "21", roleIds: ["41", "40"] }], revision: 1 }, nextPanelRevision: 1 })
    })
    const status = await (await botCall(t, "/setup/status", { serverId: "10" })).json() as { sections: { id: string, state: string }[], managedRoles: unknown[] }
    assert.equal(status.sections.length, 19)
    assert.deepEqual(status.sections.find(row => row.id === "autorole"), { id: "autorole", state: "on" })
    assert.deepEqual(status.managedRoles, [{ feature: "autorole", roleIds: ["40", "41"] }])
})
