import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import { CounterView, type CounterOperation } from "@neonflux/contracts/counters"
import { Schema } from "effect"
import { backupConfig } from "../convex/backupDomain.ts"
import { projectBackupConfig } from "../convex/backupProjections.ts"
import { MEMBER_DATA_EXEMPT } from "../convex/memberData.ts"
import { botCall } from "./bot-service.ts"
import { convexBackend } from "./convex-backend.ts"

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const prior = { ...process.env }
beforeEach(() => {
    Object.assign(process.env, {
        NEONFLUX_SERVER_ID: "10",
        NEONFLUX_BOT_API_SECRET: "synthetic-counter-service-secret-0000000000",
    })
    delete process.env.NEONFLUX_SERVER_MODE
})
afterEach(() => {
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"])
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const actor = {
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
let messageId = 100
const decode = Schema.decodeUnknownSync(CounterView, { onExcessProperty: "error" })
function fixture() {
    const backend = convexBackend(modules)
    const manage = (operation: CounterOperation, who = actor) =>
        botCall(backend, "/counters/manage", {
            serverId: "10",
            originServerId: "10",
            messageId: String(messageId++),
            createdAt: Date.now(),
            actor: who,
            managerAuthorized: true,
            operation,
        })
    const view = async () => decode(await (await botCall(backend, "/counters/query", { serverId: "10" })).json())
    return { backend, manage, view }
}
const add = (channelId: string, extra: object = {}): CounterOperation =>
    ({ type: "add", channelId, kind: "members", template: "Members: {count}", ...extra }) as CounterOperation

test("a server starts with none on, adds up to five, one per channel, and changes and removes them", async () => {
    const f = fixture()
    assert.deepEqual(await f.view(), { enabled: true, counters: [] })
    for (const channelId of ["31", "32", "33", "34", "35"]) assert.equal((await f.manage(add(channelId))).status, 200)
    assert.equal((await f.manage(add("36"))).status, 429)
    // Adding to a channel that has a counter replaces it
    assert.equal((await f.manage(add("31", { kind: "role", roleId: "77", template: "Staff: {count}" }))).status, 200)
    const counters = (await f.view()).counters
    assert.equal(counters.length, 5)
    assert.deepEqual(
        { ...counters[0], createdAt: 0 },
        { channelId: "31", kind: "role", roleId: "77", template: "Staff: {count}", enabled: true, createdAt: 0 },
    )
    assert.equal((await f.manage({ type: "set", channelId: "32", template: "Now {count}" })).status, 200)
    assert.equal((await f.view()).counters[1]!.template, "Now {count}")
    assert.equal((await f.manage({ type: "set", channelId: "99", template: "Now {count}" })).status, 404)
    assert.equal((await f.manage({ type: "remove", channelId: "32" })).status, 200)
    assert.equal((await f.manage({ type: "remove", channelId: "32" })).status, 404)
    assert.equal((await f.manage({ type: "module", enabled: false })).status, 200)
    assert.equal((await f.view()).enabled, false)
})

test("bad values and missing authority are refused, and every change has an audit entry", async () => {
    const f = fixture()
    for (const operation of [
        add("31", { template: "No count" }),
        add("31", { template: `${"x".repeat(94)}{count}` }),
        add("31", { kind: "role" }),
        add("31", { roleId: "77" }),
        add("31", { kind: "online" }),
    ])
        assert.equal((await f.manage(operation)).status, 400)
    assert.equal((await f.manage(add("31"), { ...actor, nativePermissionAuthorized: false })).status, 403)
    assert.equal((await f.manage(add("31"))).status, 200)
    assert.equal((await f.manage({ type: "module", enabled: false })).status, 200)
    const entries = await f.backend.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(
        entries.map((entry) => [entry.feature, entry.source]),
        [
            ["counters", "command"],
            ["counters", "command"],
        ],
    )
})

test("a refused rename turns its counter off once, and set turns it back on", async () => {
    const f = fixture()
    await f.manage(add("31"))
    const report = (template = "Members: {count}") =>
        botCall(f.backend, "/counters/work", { serverId: "10", channelId: "31", template, reason: "permission" })
    // A report about a name that changed since the bot read it changes nothing
    assert.deepEqual(await (await report("Old {count}")).json(), { recorded: false })
    assert.deepEqual(await (await report()).json(), { recorded: true })
    assert.deepEqual(await (await report()).json(), { recorded: false })
    const row = (await f.view()).counters[0]!
    assert.deepEqual([row.enabled, row.problem], [false, "permission"])
    await f.manage({ type: "set", channelId: "31", template: "Members: {count}" })
    const back = (await f.view()).counters[0]!
    assert.deepEqual([back.enabled, back.problem], [true, undefined])
})

test("a role count that turned unreadable is noted and cleared, and a change clears it too, without turning the counter off", async () => {
    const f = fixture()
    await f.manage(add("31", { kind: "role", roleId: "77", template: "Staff: {count}" }))
    const note = (countProblem: string | null, template = "Staff: {count}") =>
        botCall(f.backend, "/counters/work", { serverId: "10", channelId: "31", template, countProblem })
    assert.deepEqual(await (await note("twoFactor", "Old {count}")).json(), { recorded: false })
    assert.deepEqual(await (await note("twoFactor")).json(), { recorded: true })
    const noted = (await f.view()).counters[0]!
    assert.deepEqual([noted.enabled, noted.countProblem], [true, "twoFactor"])
    assert.equal((await note("other")).status, 400)
    await note(null)
    assert.equal((await f.view()).counters[0]!.countProblem, undefined)
    await note("permission")
    await f.manage({ type: "set", channelId: "31", template: "Staff: {count}" })
    assert.equal((await f.view()).counters[0]!.countProblem, undefined)
})

test("a counter names staff who changed it, as a staff setting member data leaves out", () => {
    assert.ok(MEMBER_DATA_EXEMPT.counters)
})

test("a server's counters are its own", async () => {
    const f = fixture()
    await f.manage(add("31"))
    await f.backend.run((ctx) =>
        ctx.db.insert("counters", {
            serverId: "11",
            channelId: "31",
            kind: "members",
            template: "Other {count}",
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
            updatedBy: "20",
        }),
    )
    assert.equal((await f.view()).counters[0]!.template, "Members: {count}")
    assert.equal((await botCall(f.backend, "/counters/query", { serverId: "11" })).status, 403)
})

test("a backup keeps the switch and each counter, without its state", async () => {
    const f = fixture()
    await f.manage(add("31", { kind: "role", roleId: "77", template: "Staff: {count}" }))
    await f.manage({ type: "module", enabled: false })
    await botCall(f.backend, "/counters/work", {
        serverId: "10",
        channelId: "31",
        template: "Staff: {count}",
        reason: "permission",
    })
    const [row, settings] = await f.backend.run(async (ctx) => [
        await ctx.db.query("counters").first(),
        await ctx.db.query("counterSettings").first(),
    ])
    const counter = projectBackupConfig("counter", row),
        module = projectBackupConfig("counters", settings)
    assert.deepEqual(counter, {
        family: "counter",
        sourceId: "31",
        value: { channelId: "31", kind: "role", roleId: "77", template: "Staff: {count}" },
    })
    assert.deepEqual(module, { family: "counters", sourceId: "counters", value: { enabled: false } })
    assert.deepEqual(backupConfig(counter), counter)
    assert.throws(() =>
        backupConfig({ ...counter, value: { channelId: "31", kind: "role", template: "Staff: {count}" } }),
    )
})
