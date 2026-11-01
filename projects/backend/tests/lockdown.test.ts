import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import type { LockdownPlanRow, LockdownResult, LockdownStatus, LockdownWorkResult } from "@neonflux/contracts/lockdown"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"
import { readRecoveryInbox } from "../convex/recovery.ts"
import { readSetupSections } from "../convex/setupCheck.ts"
import { dueWork } from "../convex/workDispatch.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { reserveAction } from "../convex/moderationActions.ts"
import { metadataState } from "../convex/metadataLogsStore.ts"
import { metadataLogContent } from "@neonflux/contracts/metadata-logs"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z")
let clock = start
beforeEach(() => {
    clock = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-lockdown-test-secret-not-a-credential"
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
const staff = (roleIds: string[] = [], native = true, owner = false) => ({
    originServerId: "10",
    userId: "20",
    roleIds,
    isOwner: owner,
    isAdministrator: false,
    nativePermissionAuthorized: native,
})
const owner = staff([], true, true)
const row = (channelId: string, fields: Partial<LockdownPlanRow> = {}): LockdownPlanRow => ({
    channelId,
    everyone: { exists: false, allow: "0", deny: "0" },
    bits: "2048",
    botBefore: { exists: false, allow: "0", deny: "0" },
    ...fields,
})
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async <T>(path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result as T
    }
    const manage = (operation: unknown, actor: unknown = owner, expected = 200) =>
        post<LockdownResult>(
            "/lockdown/manage",
            { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor, operation },
            expected,
        )
    const work = (body: object) => post<LockdownWorkResult>("/lockdown/work", { serverId: "10", ...body })
    const get = (actor: unknown = owner) => post<LockdownStatus>("/lockdown/get", { serverId: "10", actor })
    return { t, post, manage, work, get }
}
const insertModeration = (ctx: { db: { insert: (table: never, value: never) => Promise<unknown> } }) =>
    ctx.db.insert(
        "moderationSettings" as never,
        {
            serverId: "10",
            config: {
                ...defaultSettings(),
                logChannelId: "60",
                staffRoleIds: { moderation: [], cases: [], automod: [], security: ["7"], appeals: [] },
            },
            nextCaseNo: 1,
            nextAppealNo: 1,
        } as never,
    )
const claim = (f: ReturnType<typeof fixture>) => f.work({ type: "claim" })
const report = (f: ReturnType<typeof fixture>, outcome: string, ...ids: string[]) =>
    f.work({ type: "report", rows: ids.map((channelId) => ({ channelId, outcome })) })

test("A lockdown runs through its channels, stays one per server and records its start and end", async () => {
    const f = fixture()
    assert.deepEqual(await f.get(), { settings: { exemptChannelIds: [] }, lockdown: null })
    await f.manage({ type: "exempt", channelId: "33", exempt: true })
    const started = await f.manage({
        type: "on",
        reason: "A raid",
        plan: [row("31"), row("32"), row("33"), row("34", { skip: "private", bits: "0" })],
    })
    assert.equal(started.started, true)
    // The exempt channel and the private one hold nothing
    assert.deepEqual(started.lockdown?.counts, {
        queued: 2,
        writing: 0,
        locked: 0,
        uncertain: 0,
        failed: 0,
        skipped: 2,
        restored: 0,
    })
    assert.equal(started.lockdown?.state, "locking")
    assert.equal((await f.manage({ type: "on", plan: [row("31")] })).refused, "already-on")
    const first = await claim(f)
    assert.deepEqual(first.rows.map((item) => item.channelId).sort(), ["31", "32"])
    assert.equal((await f.get()).lockdown?.counts.writing, 2)
    await report(f, "done", "31", "32")
    const on = (await f.get()).lockdown
    assert.equal(on?.state, "active")
    assert.equal(on?.counts.locked, 2)
    assert.deepEqual((await claim(f)).rows, [])
    // Lifting queues what the lockdown holds and leaves the rest alone
    const lifting = await f.manage({ type: "off", reason: "Over" })
    assert.equal(lifting.lockdown?.state, "restoring")
    assert.equal(lifting.lockdown?.counts.queued, 2)
    const back = await claim(f)
    assert.deepEqual(
        back.rows.map((item) => item.phase),
        ["restore", "restore"],
    )
    const done = await report(f, "done", "31", "32")
    assert.equal(done.rows.length, 0)
    const ended = (await f.get()).lockdown
    assert.equal(ended?.state, "ended")
    assert.equal(ended?.endReason, "Over")
    assert.equal(ended?.counts.restored, 2)
    assert.equal((await f.manage({ type: "off" })).refused, "not-on")
    await f.t.run(async (ctx) => {
        const records = await ctx.db.query("metadataLogRecords").collect()
        assert.deepEqual(records.length, 0)
    })
})

test("Only the owner, Administrators and security staff with the native permission change a lockdown, and off stays reachable at DEFCON 1", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: [row("31")] }, staff(), 403)
    await f.t.run(async (ctx) => {
        await insertModeration(ctx as never)
    })
    await f.manage({ type: "on", plan: [row("31")] }, staff(["7"], false), 403)
    assert.equal((await f.manage({ type: "on", plan: [row("31")] }, staff(["7"]))).started, true)
    assert.deepEqual(await f.get(staff(["7"])).then((value) => value.lockdown?.startedBy), "20")
    // The first claim hands the staff log note out once
    const first = await claim(f)
    assert.deepEqual(first.notes, [{ kind: "started", logChannelId: "60", by: "20", reason: "" }])
    await report(f, "done", "31")
    assert.deepEqual((await claim(f)).notes, [])
    await f.t.run(async (ctx) => {
        const settings = (await ctx.db.query("moderationSettings").first())!
        await ctx.db.patch(settings._id, { config: { ...settings.config, defcon: 1 } })
    })
    await f.manage({ type: "exempt", channelId: "33", exempt: true }, staff(["7"]), 403)
    await f.manage({ type: "off" }, staff(["7"]), 403)
    const lifted = await f.manage({ type: "off" })
    assert.equal(lifted.lockdown?.state, "restoring")
})

test("A claimed write that never reports becomes uncertain and is never queued again, and a restart goes on with the rest", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: Array.from({ length: 25 }, (_, i) => row(String(100 + i))) })
    const first = await claim(f)
    assert.equal(first.rows.length, 20)
    // The process stops here. The dispatcher still reports the server, and a new claim goes on with the queued channels
    const due = await f.t.run((ctx) => dueWork(ctx, clock, null))
    assert.deepEqual(due.kinds.lockdown, ["10"])
    const second = await claim(f)
    assert.equal(second.rows.length, 5)
    await report(f, "done", ...second.rows.map((item) => item.channelId))
    clock += 300001
    const third = await claim(f)
    assert.equal(third.rows.length, 0)
    const after = (await f.get()).lockdown
    assert.equal(after?.counts.uncertain, 20)
    assert.equal(after?.state, "active")
    assert.equal(after?.problems.length, 10)
    // Nothing is left for the dispatcher to wake the worker for
    assert.deepEqual((await f.t.run((ctx) => dueWork(ctx, clock, null))).kinds.lockdown, [])
    // Status settles what it reads, here from the bot's report of what the channels hold
    const problems = await f.work({ type: "problems" })
    assert.equal(problems.rows.length, 10)
    await report(f, "done", problems.rows[0]!.channelId)
    await report(f, "failed", problems.rows[1]!.channelId)
    const settled = (await f.get()).lockdown
    assert.equal(settled?.counts.uncertain, 18)
    assert.equal(settled?.counts.failed, 1)
    assert.equal(settled?.counts.locked, 6)
    // A failed channel goes again only on an explicit repeat
    const repeated = await f.manage({ type: "on", plan: [] })
    assert.equal(repeated.requeued, 1)
    assert.equal(repeated.lockdown?.state, "locking")
})

test("Lifting skips what was never written, and a write still running goes back to be restored when it reports", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: Array.from({ length: 22 }, (_, i) => row(String(100 + i))) })
    const first = await claim(f)
    assert.equal(first.rows.length, 20)
    const lifted = await f.manage({ type: "off" })
    assert.equal(lifted.lockdown?.counts.restored, 2)
    assert.equal(lifted.lockdown?.counts.writing, 20)
    await report(f, "done", ...first.rows.slice(0, 19).map((item) => item.channelId))
    // Even a write given back may have set NeonFlux's own allow, so it is read again too
    await report(f, "retry", first.rows[19]!.channelId)
    const status = (await f.get()).lockdown
    assert.equal(status?.counts.queued, 20)
    assert.equal(status?.counts.restored, 2)
    const back = await claim(f)
    assert.equal(
        back.rows.every((item) => item.phase === "restore"),
        true,
    )
    await report(f, "done", ...back.rows.map((item) => item.channelId))
    assert.equal((await f.get()).lockdown?.state, "ended")
})

test("A write known unsent goes again a few times with growing waits, then fails, and a repeat starts over", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: [row("31"), row("32")] })
    await claim(f)
    await report(f, "gone", "32")
    assert.equal((await f.get()).lockdown?.counts.skipped, 1)
    for (const wait of [10000, 20000, 40000, 80000]) {
        await report(f, "retry", "31")
        assert.deepEqual((await claim(f)).rows, [])
        clock += wait - 1
        assert.deepEqual((await claim(f)).rows, [])
        clock += 2
        assert.deepEqual(
            (await claim(f)).rows.map((item) => item.channelId),
            ["31"],
        )
    }
    await report(f, "retry", "31")
    assert.equal((await f.get()).lockdown?.counts.failed, 1)
    assert.deepEqual((await claim(f)).rows, [])
    assert.equal((await f.manage({ type: "on", plan: [] })).requeued, 1)
    assert.equal((await claim(f)).rows.length, 1)
    await report(f, "retry", "31")
    assert.equal((await f.get()).lockdown?.counts.queued, 1)
})

test("A lift while a write waits to go again reads that channel, since an earlier try may have left NeonFlux's own allow", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: [row("31"), row("32"), row("33")] })
    const first = await f.work({ type: "claim" })
    assert.equal(first.rows.length, 3)
    await report(f, "retry", "31")
    // A failed channel an explicit repeat queued again was reached too
    await report(f, "failed", "32")
    await f.manage({ type: "on", plan: [] })
    await report(f, "done", "33")
    const lifted = await f.manage({ type: "off" })
    assert.equal(lifted.lockdown?.counts.restored, 0)
    clock += 1
    const back = await f.work({ type: "claim" })
    assert.deepEqual(back.rows.map((item) => [item.channelId, item.phase]).sort(), [
        ["31", "restore"],
        ["32", "restore"],
        ["33", "restore"],
    ])
})

test("The start and end records name who did it, and anti-nuke's name no one", async () => {
    const f = fixture()
    await f.t.run(async (ctx) => {
        const logs = await metadataState(ctx, "10")
        await ctx.db.patch(logs._id, {
            enabled: true,
            routes: logs.routes.map((route) =>
                route.category === "security" ? { ...route, enabled: true, channelId: "60" } : route,
            ),
        })
    })
    await f.manage({ type: "on", plan: [] })
    await f.manage({ type: "off" })
    const records = await f.t.run((ctx) => ctx.db.query("metadataLogRecords").collect())
    assert.deepEqual(
        records.map((record) => [
            record.event.type,
            record.event.actor,
            record.event.resourceIds,
            record.event.changedFields,
        ]),
        [
            ["lockdown-change", { kind: "configuration", userId: "20" }, [], ["lockdown-started"]],
            ["lockdown-change", { kind: "configuration", userId: "20" }, [], ["lockdown-ended"]],
        ],
    )
    const text = metadataLogContent(1, { ...records[0]!.event, originServerId: "10" } as never, "10")
    assert.match(text, /By: <@20>/)
    assert.match(text, /Source: NeonFlux/)
    const auto = metadataLogContent(
        1,
        { ...records[0]!.event, actor: { kind: "unknown" }, originServerId: "10" } as never,
        "10",
    )
    assert.match(auto, /By: Anti-nuke/)
})

test("A new lockdown replaces the last one's rows, and refuses while channels are still owed", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: [row("31")] })
    await report(f, "done", ...(await claim(f)).rows.map((item) => item.channelId))
    assert.equal((await f.manage({ type: "on", plan: [row("31")] })).refused, "already-on")
    await f.manage({ type: "off" })
    assert.equal((await f.manage({ type: "on", plan: [row("31")] })).refused, "restoring")
    await report(f, "failed", ...(await claim(f)).rows.map((item) => item.channelId))
    assert.equal((await f.get()).lockdown?.state, "ended")
    // What the failed channel held is only in its row, so a new lockdown would lose it
    assert.equal((await f.manage({ type: "on", plan: [row("41")] })).refused, "unrestored")
    assert.equal((await f.manage({ type: "off" })).lockdown?.counts.queued, 1)
    await report(f, "done", ...(await claim(f)).rows.map((item) => item.channelId))
    const next = await f.manage({ type: "on", plan: [row("41")] })
    assert.equal(next.started, true)
    assert.equal(next.lockdown?.counts.queued, 1)
    await f.t.run(async (ctx) => {
        const rows = await ctx.db.query("lockdownChannels").collect()
        assert.deepEqual(
            rows.map((item) => item.channelId),
            ["41"],
        )
    })
})

test("A channel lock is refused while the lockdown holds the channel", async () => {
    const f = fixture()
    await f.manage({ type: "on", plan: [row("31")] })
    const lock = (channelId: string) =>
        f.t.run((ctx) =>
            reserveAction(ctx, {
                serverId: "10",
                sourceId: "manual:1",
                settings: defaultSettings(),
                actor: owner,
                input: { type: "lock", channelId },
                context: {
                    originServerId: "10",
                    botId: "90",
                    botActionAuthorized: true,
                    actorCanManageTarget: true,
                    botCanManageTarget: true,
                    targetProtected: false,
                    currentOverwrite: { exists: false, allow: "0", deny: "0" },
                },
                origin: "manual",
                now: clock,
            }),
        )
    await assert.rejects(lock("31"), /server-wide lockdown already locks this channel/)
    assert.equal((await lock("32")).grant.action, "lock")
})

test("The setup check and recovery inbox show a lockdown's state and its problem channels", async () => {
    const f = fixture()
    const section = async () =>
        (await f.t.run((ctx) => readSetupSections(ctx, "10"))).find((item) => item.id === "lockdown")?.state
    assert.equal(await section(), "off")
    await f.manage({ type: "on", plan: [row("31"), row("32")] })
    assert.equal(await section(), "on")
    await claim(f)
    await report(f, "uncertain", "31")
    await report(f, "failed", "32")
    const inbox = await f.t.run((ctx) => readRecoveryInbox(ctx, "10"))
    const entries = inbox.entries.filter((entry) => entry.kind === "work" && entry.source === "lockdown") as {
        summary: string
        next: string
    }[]
    assert.equal(entries.length, 2)
    assert.match(entries[0]!.summary, /could not confirm whether it locked <#31>/)
    assert.match(entries[0]!.next, /!lockdown status/)
    assert.match(entries[1]!.summary, /could not lock <#32>/)
})

test("The exempt list keeps each channel once, and the website replaces it whole", async () => {
    const f = fixture()
    await f.manage({ type: "exempt", channelId: "33", exempt: true })
    assert.deepEqual((await f.manage({ type: "exempt", channelId: "33", exempt: true })).settings.exemptChannelIds, [
        "33",
    ])
    assert.deepEqual((await f.manage({ type: "exempt", channelId: "33", exempt: false })).settings.exemptChannelIds, [])
})

test("Anti-nuke starts a lockdown only where its settings allow", async () => {
    const f = fixture()
    const auto = () => f.post<LockdownResult>("/lockdown/auto", { serverId: "10", incidentNo: 3, plan: [row("31")] })
    assert.equal((await auto()).started, undefined)
    await f.t.run((ctx) =>
        insertDocument(ctx, "antiNukeSettings", "10", { enabled: true, mode: "enforce", lockdown: true }),
    )
    const started = await auto()
    assert.equal(started.started, true)
    assert.equal(started.lockdown?.origin, "antinuke")
    assert.equal(started.lockdown?.reason, "Anti-nuke incident 3")
    assert.equal(started.lockdown?.startedBy, undefined)
    assert.equal((await auto()).refused, "already-on")
})
