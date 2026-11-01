import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { REMINDER_MEMBER_LIMITS, REMINDER_SERVER_LIMIT } from "@neonflux/contracts/reminders"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { cleanupReminders } from "../convex/remindersStore.ts"
import { dueWork } from "../convex/workDispatch.ts"
import { botCall } from "./bot-service.ts"
import { convexBackend } from "./convex-backend.ts"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z"),
    MINUTE = 60000,
    DAY = 86400000
let now = start
beforeEach(() => {
    now = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-reminder-test-secret-not-a-credential"
    delete process.env.NEONFLUX_SERVER_MODE
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"])
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const member = (userId: string, roleIds: string[] = []) => ({
    originServerId: "10",
    userId,
    roleIds,
    isOwner: false,
    isAdministrator: false,
    nativePermissionAuthorized: false,
})
const manager = { ...member("99"), isOwner: true, nativePermissionAuthorized: true }

function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body),
            result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, who = member("21"), expected = 200) =>
        post(
            "/reminders/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: now,
                actor: who,
                managerAuthorized: who === manager,
                operation,
            },
            expected,
        )
    const create = (who = "21", seconds = 3600, text = "take out the bins") =>
        manage({ type: "create", seconds, text, channelId: "50" }, member(who))
    const list = (userId = "21") => post("/reminders/query", { serverId: "10", userId })
    const work = (operation: unknown) => post("/reminders/work", { serverId: "10", operation })
    const claim = () => work({ type: "claim" })
    const outcome = (reminderNo: number, value: string, userId = "21") =>
        work({ type: "outcome", userId, reminderNo, outcome: value })
    const rows = () => t.run((ctx) => ctx.db.query("reminders").collect())
    const stored = () => t.run(async (ctx) => (await ctx.db.query("reminderSettings").first())?.stored)
    const dispatch = () => t.run((ctx) => dueWork(ctx as never, now, null))
    return { t, post, manage, create, list, work, claim, outcome, rows, stored, dispatch }
}
// Writes the setting directly, since the chat form also needs a fresh read of staff roles that these tests have no part in
const setModeration = (f: ReturnType<typeof fixture>, patch: Record<string, unknown>) =>
    f.t.run(async (ctx) => {
        const row = await ctx.db.query("moderationSettings").first()
        if (row) await ctx.db.patch(row._id, { config: { ...row.config, ...patch } })
        else
            await ctx.db.insert("moderationSettings", {
                serverId: "10",
                config: { ...defaultSettings(), ...patch },
                nextCaseNo: 1,
                nextAppealNo: 1,
            } as never)
    })

test("A member sets, lists and cancels reminders, with numbers of their own and the text stored as typed", async () => {
    const f = fixture()
    const typed = '  keep   "this" exactly\nas typed <@&5> @everyone'.trim()
    const first = await f.create("21", 7200, typed)
    assert.equal(first.type, "created")
    assert.deepEqual(first.reminder, {
        reminderNo: 1,
        text: typed,
        channelId: "50",
        dueAt: now + 7200000,
        state: "active",
        createdAt: now,
    })
    assert.equal((await f.create()).reminder.reminderNo, 2)
    // Another member's numbers start at one, and neither member can see or cancel the other's
    assert.equal((await f.create("22")).reminder.reminderNo, 1)
    assert.deepEqual(
        (await f.list()).reminders.map((row: { reminderNo: number }) => row.reminderNo),
        [2, 1],
    )
    assert.equal((await f.list("22")).reminders.length, 1)
    assert.deepEqual(await f.manage({ type: "cancel", reminderNo: 2 }, member("22")), {
        type: "refused",
        reason: "missing",
    })
    assert.deepEqual(await f.manage({ type: "cancel", reminderNo: 2 }), { type: "cancelled", reminderNo: 2 })
    assert.equal(await f.stored(), 2)
    // Nothing about a member's reminders reaches the audit log
    assert.equal((await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())).length, 0)
})

test("Requests outside the bounds are refused", async () => {
    const f = fixture()
    for (const seconds of [59, 31536001])
        await f.manage({ type: "create", seconds, text: "x", channelId: "50" }, member("21"), 400)
    await f.manage({ type: "create", seconds: 60, text: "x".repeat(501), channelId: "50" }, member("21"), 400)
    await f.manage({ type: "create", seconds: 60, text: "   ", channelId: "50" }, member("21"), 400)
    assert.equal((await f.create("21", 60, "x".repeat(500))).type, "created")
    assert.equal((await f.create("21", 31536000)).type, "created")
})

test("Settings need a manager and are audited, a member keeps up to the limit, and a server holds a bounded number", async () => {
    const f = fixture()
    await f.manage({ type: "settings", patch: { enabled: false } }, member("21"), 403)
    for (const patch of [{}, { memberLimit: 0 }, { memberLimit: 26 }])
        await f.manage({ type: "settings", patch }, manager, 400)
    assert.deepEqual(await f.manage({ type: "settings", patch: { memberLimit: 2 } }, manager), {
        type: "settings",
        settings: { enabled: true, memberLimit: 2 },
    })
    const audit = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(
        audit.map((row) => [row.feature, row.summary]),
        [["reminders", "memberLimit: 25 → 2"]],
    )
    await f.create()
    await f.create()
    assert.deepEqual(await f.create(), { type: "refused", reason: "member-limit", limit: 2 })
    // An uncertain reminder still counts, so uncertain ones cannot pile up
    now += 2 * 3600000
    await f.claim()
    await f.outcome(1, "uncertain")
    assert.deepEqual(await f.create(), { type: "refused", reason: "member-limit", limit: 2 })
    await f.t.run(async (ctx) => {
        const row = (await ctx.db.query("reminderSettings").first())!
        await ctx.db.patch(row._id, { stored: REMINDER_SERVER_LIMIT })
    })
    assert.deepEqual(await f.create("22"), {
        type: "refused",
        reason: "server-limit",
        limit: REMINDER_SERVER_LIMIT,
    })
    assert.equal(REMINDER_MEMBER_LIMITS[1], 25)
})

test("A reminder is claimed before it is sent and never handed out twice", async () => {
    const f = fixture()
    await f.create()
    assert.deepEqual((await f.claim()).reminders, [])
    now += 3600000
    const claimed = await f.claim()
    assert.deepEqual(claimed.reminders, [{ userId: "21", reminderNo: 1, text: "take out the bins", channelId: "50" }])
    assert.deepEqual((await f.claim()).reminders, [])
    assert.equal((await f.list()).reminders[0].state, "sending")
    // Delivered reminders are deleted and leave the server's count
    assert.deepEqual(await f.outcome(1, "delivered"), { type: "recorded", recorded: true })
    assert.equal((await f.rows()).length, 0)
    assert.equal(await f.stored(), 0)
    // A second report changes nothing
    assert.deepEqual(await f.outcome(1, "delivered"), { type: "recorded", recorded: false })
})

test("An unknown outcome stays uncertain, is listed, is never repeated and expires after 30 days", async () => {
    const f = fixture()
    await f.create()
    now += 3600000
    await f.claim()
    await f.outcome(1, "uncertain")
    assert.equal((await f.list()).reminders[0].state, "uncertain")
    now += 10 * DAY
    assert.deepEqual((await f.claim()).reminders, [])
    assert.deepEqual((await f.dispatch()).kinds.reminders, [])
    now += 21 * DAY
    assert.deepEqual(await f.t.run((ctx) => cleanupReminders(ctx as never, now)), { more: false })
    assert.equal((await f.rows()).length, 0)
    assert.equal(await f.stored(), 0)
})

test("A claim that never reported turns uncertain instead of being sent again", async () => {
    const f = fixture()
    await f.create()
    now += 3600000
    await f.claim()
    now += 4 * MINUTE
    assert.deepEqual((await f.dispatch()).kinds.reminders, [])
    now += 2 * MINUTE
    assert.deepEqual((await f.dispatch()).kinds.reminders, ["10"])
    assert.deepEqual((await f.claim()).reminders, [])
    assert.equal((await f.list()).reminders[0].state, "uncertain")
})

test("A failed read of the member sends nothing, so that reminder is tried again", async () => {
    const f = fixture()
    await f.create()
    now += 3600000
    await f.claim()
    await f.outcome(1, "retry")
    assert.equal((await f.list()).reminders[0].state, "active")
    assert.deepEqual((await f.claim()).reminders, [])
    now += MINUTE
    assert.equal((await f.claim()).reminders.length, 1)
})

test("A member who left is skipped and a reminder that cannot be delivered stays listed", async () => {
    const f = fixture()
    await f.create()
    await f.create("22")
    now += 3600000
    await f.claim()
    await f.outcome(1, "skipped")
    await f.outcome(1, "undelivered", "22")
    assert.deepEqual((await f.list()).reminders, [])
    assert.equal((await f.list("22")).reminders[0].state, "undelivered")
})

test("DEFCON below 3 and the module switch hold delivery, and delivery resumes after", async () => {
    const f = fixture()
    await f.create()
    now += 3600000
    assert.deepEqual((await f.dispatch()).kinds.reminders, ["10"])
    await setModeration(f, { defcon: 2 })
    assert.deepEqual((await f.dispatch()).kinds.reminders, [])
    assert.deepEqual((await f.claim()).reminders, [])
    await setModeration(f, { defcon: 3 })
    await f.manage({ type: "settings", patch: { enabled: false } }, manager)
    assert.deepEqual((await f.dispatch()).kinds.reminders, [])
    assert.deepEqual((await f.claim()).reminders, [])
    // Off refuses new reminders. Members can still see and cancel theirs
    assert.deepEqual(await f.create(), { type: "refused", reason: "off" })
    assert.equal((await f.list()).reminders.length, 1)
    await f.manage({ type: "settings", patch: { enabled: true } }, manager)
    assert.deepEqual((await f.dispatch()).kinds.reminders, ["10"])
    assert.equal((await f.claim()).reminders.length, 1)
})

test("An idle server costs nothing: A reminder due later is only a next due time", async () => {
    const f = fixture()
    await f.create()
    const work = await f.dispatch()
    assert.deepEqual(work.kinds.reminders, [])
    assert.equal(work.nextDueIn, 3600000)
})

test("The text is checked against the content rules for the member, in the reminder's channel", async () => {
    const f = fixture()
    await f.create("21", 60, "visit evil.example.test now")
    now += MINUTE
    await f.claim()
    const check = (roleIds: string[] = []) => f.work({ type: "check", userId: "21", reminderNo: 1, roleIds })
    assert.deepEqual(await check(), { type: "check", allowed: true })
    await setModeration(f, { automodEnabled: true })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("automodRules", {
            serverId: "10",
            name: "words",
            rule: {
                name: "words",
                type: "words",
                enabled: true,
                priority: 1,
                action: "delete",
                threshold: 1,
                windowSeconds: 10,
                durationSeconds: 60,
                patterns: ["evil"],
                domainMode: "block",
                channelIds: [],
                exemptChannelIds: [],
                exemptRoleIds: ["77"],
            },
        } as never)
    })
    assert.deepEqual(await check(), { type: "check", allowed: false })
    // A role the rule exempts lets the text through, as it would for that member's own message
    assert.deepEqual(await check(["77"]), { type: "check", allowed: true })
})

test("Member data rights show, export and delete a member's reminders, and each server stays apart", async () => {
    const f = fixture()
    await f.create("70", 3600, "private words")
    await f.t.run(async (ctx) => {
        await ctx.db.insert("reminders", {
            serverId: "11",
            userId: "70",
            reminderNo: 1,
            text: "another server",
            channelId: "51",
            state: "active",
            due: true,
            dueAt: now,
            nextCheckAt: now,
            createdAt: now,
            expiresAt: now + DAY,
        })
    })
    // Server 11's reminder is due but this server's worker never sees it
    now += 3600000
    assert.deepEqual(
        (await f.claim()).reminders.map((row: { text: string }) => row.text),
        ["private words"],
    )
    now += 1
    const page = await f.post("/service/member-data/export", { userId: "70", serverId: "10", cursor: null })
    const records = page.records.filter((record: { feature: string }) => record.feature === "Reminders")
    assert.equal(records.length, 1)
    assert.equal(records[0].data.text, "private words")
    const deleted = await f.post("/service/member-data/delete", {
        userId: "70",
        userName: "Synthetic member",
        serverId: "10",
        cursor: null,
    })
    assert.deepEqual(deleted.deleted, [{ feature: "Reminders", count: 1 }])
    assert.deepEqual(
        (await f.rows()).map((row) => row.serverId),
        ["11"],
    )
    assert.equal(await f.stored(), 0)
})
