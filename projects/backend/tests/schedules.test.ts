import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import type {
    SchedulesCalendar,
    SchedulesContext,
    SchedulesDelivery,
    SchedulesDeliveryGrant,
} from "@neonflux/contracts/schedules"
import schema from "../convex/schema.ts"
import { cleanupSchedules } from "../convex/schedulesCleanup.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import { validateScheduleCalendar } from "../convex/schedulesDomain.ts"
import { civilDayEnded, resolveCivilInstant } from "../convex/civilDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID,
    oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-schedules-secret-not-a-credential-000"
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = oldServer
    if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = oldSecret
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/schedules.ts": () => import("../convex/schedules.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/schedulesCleanup.ts": () => import("../convex/schedulesCleanup.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
async function read(response: Response): Promise<any> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
    assert(!JSON.stringify(await response.json()).includes(secret))
}
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"),
        sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexBackend(modules)
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (): SchedulesContext => ({
        observedAt: now,
        actor: owner,
        channelId: "30",
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        member: {
            userId: "10",
            joinedAt: "2025-12-01T00:00:00.000001Z",
            roleIds: [],
            isBot: false,
            timeoutUntil: null,
            canView: true,
            canReadHistory: true,
        },
    })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manage = (operation: unknown, current = context()) =>
        http("/schedules/manage", { ...source(), context: current, operation })
    const query = (operation: unknown) => http("/schedules/query", { serverId: "1", context: context(), operation })
    const publish = (operation: unknown) => http("/publishing/manage", { ...source(), actor: owner, operation })
    await read(await publish({ type: "draft-create", kind: "draft", name: "announcement" }))
    await read(
        await publish({
            type: "draft-update",
            kind: "draft",
            name: "announcement",
            expectedRevision: 1,
            edit: { type: "content", content: "Synthetic announcement" },
        }),
    )
    const snapshot = { kind: "draft", name: "announcement", revision: 2 }
    const calendar = (count = 1, dueAt = now + 120000): SchedulesCalendar => ({
        localMinute: new Date(dueAt).toISOString().slice(0, 16),
        zone: "UTC",
        fold: "reject",
        recurrence: count === 1 ? { type: "none" } : { type: "daily", interval: 1, count },
        dates: Array.from({ length: count }, (_, i) => ({
            localMinute: new Date(dueAt + i * 86400000).toISOString().slice(0, 16),
            dueAt: dueAt + i * 86400000,
            offsetMinutes: 0,
        })),
    })
    const create = (name = "notice", count = 1) =>
        manage({ type: "create", name, source: snapshot, channelId: "30", calendar: calendar(count) })
            .then(read)
            .then((value) => value.schedule)
    const show = (scheduleNo = 1) =>
        query({ type: "show", scheduleNo })
            .then(read)
            .then((value) => value.schedule)
    const deliveries = (
        scheduleNo = 1,
        afterOccurrenceNo?: number,
    ): Promise<{ deliveries: SchedulesDelivery[]; nextAfterOccurrenceNo?: number }> =>
        query({
            type: "deliveries",
            scheduleNo,
            ...(afterOccurrenceNo === undefined ? {} : { afterOccurrenceNo }),
        }).then(read)
    const totals = () => query({ type: "status" }).then(read)
    const stored = () => db.run((ctx) => ctx.db.query("scheduleDeliveries").collect()).then((rows) => rows.length)
    const change = async (operation: Record<string, unknown>, scheduleNo = 1) =>
        read(await manage({ ...operation, scheduleNo, expectedRevision: (await show(scheduleNo)).revision }))
    const open = async (count = 1) => {
        await read(await manage({ type: "settings", expectedRevision: 1, enabled: true }))
        await create("notice", count)
        return change({ type: "enable" })
    }
    const binding = (row: SchedulesDelivery) => ({
        deliveryId: row.deliveryId,
        scheduleNo: row.scheduleNo,
        planRevision: row.planRevision,
        occurrenceNo: row.occurrenceNo,
    })
    const delivery = (operation: unknown) => http("/schedules/delivery", { serverId: "1", operation })
    const automation = () => ({ observedAt: now, channelId: "30", botId: "999", botAuthorized: true })
    const reserve = (row: SchedulesDelivery, current: unknown = automation()) =>
        delivery({ type: "reserve", binding: binding(row), context: current })
    const dispatch = (grant: SchedulesDeliveryGrant, current: unknown = automation(), claimToken = "a".repeat(32)) =>
        http("/publishing/dispatch", {
            serverId: "1",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
            claimToken,
            scheduleContext: current,
        })
    const outcome = (grant: SchedulesDeliveryGrant, value = "sent", messageId = "8000") =>
        http("/publishing/outcome", {
            serverId: "1",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
            claimToken: "a".repeat(32),
            outcome: value,
            ...(value === "sent" ? { messageId } : {}),
        })
    const cleanup = () => db.run((ctx) => retentionPass(ctx, cleanupSchedules))
    return {
        db,
        source,
        context,
        automation,
        http,
        manage,
        query,
        publish,
        snapshot,
        calendar,
        create,
        show,
        deliveries,
        totals,
        stored,
        change,
        open,
        binding,
        delivery,
        reserve,
        dispatch,
        outcome,
        cleanup,
        advance: (ms: number) => {
            now += ms
        },
        now: () => now,
    }
}

test("Schedule indexes have no duplicate field sets within changed tables", () => {
    for (const name of [
        "scheduleSettings",
        "schedules",
        "scheduleDeliveries",
        "scheduleReceipts",
        "publishingSettings",
        "publishingPosts",
        "publishingAttempts",
    ] as const) {
        const indexes = schema.tables[name][" indexes"](),
            fields = indexes.map((index) => JSON.stringify(index.fields))
        assert.equal(new Set(fields).size, fields.length, name)
    }
})

test("Schedule civil validation accepts any end and far dates, and preserves explicit folds and elapsed-free instants", async (t) => {
    const f = await fixture(t)
    assert.equal(validateScheduleCalendar(f.calendar(26)).dates.length, 26)
    const base = f.calendar(),
        daily = f.calendar(2)
    // A repeat stores its first dates, so its count may exceed them, and it may end on a date or never
    for (const recurrence of [
        { type: "daily", interval: 1, count: 27 },
        { type: "daily", interval: 1, count: 40 },
        { type: "daily", interval: 1 },
        { type: "daily", interval: 1, until: daily.dates[1]!.localMinute.slice(0, 10) },
    ])
        assert.equal(validateScheduleCalendar({ ...daily, recurrence }).dates.length, 2)
    assert.equal(validateScheduleCalendar(f.calendar(1, f.now() + 200 * 86400000)).dates.length, 1)
    assert.equal(
        validateScheduleCalendar({ ...base, recurrence: { type: "daily", interval: 400, count: 2 } }).dates.length,
        1,
    )
    const far = f.calendar(14, f.now() + 120000)
    for (const changed of [
        { ...base, dates: [] },
        { ...base, durationMinutes: 1 },
        { ...base, fold: "automatic" },
        { ...daily, recurrence: { type: "daily", interval: 1, count: 1 } },
        { ...daily, recurrence: { type: "daily", interval: 1, count: 3, until: "2027-01-01" } },
        { ...daily, recurrence: { type: "daily", interval: 1, until: daily.dates[0]!.localMinute.slice(0, 10) } },
        { ...daily, recurrence: { type: "daily", interval: 1, until: "2026-02-30" } },
        { ...daily, recurrence: { type: "daily", interval: 1, count: 0 } },
        { ...f.calendar(27), recurrence: { type: "daily", interval: 1 } },
        // The first dates span at most 180 days
        {
            ...far,
            recurrence: { type: "weekly", interval: 2 },
            dates: far.dates.map((_, i) => ({
                localMinute: new Date(far.dates[0]!.dueAt + i * 14 * 86400000).toISOString().slice(0, 16),
                dueAt: far.dates[0]!.dueAt + i * 14 * 86400000,
                offsetMinutes: 0,
            })),
        },
        { ...base, recurrence: { type: "daily", count: 1, interval: 0 } },
        // A second date after the year 9999 cannot be named
        { ...base, recurrence: { type: "weekly", interval: Number.MAX_SAFE_INTEGER } },
        { ...base, recurrence: { type: "forever" } },
        { ...base, dates: [{ ...base.dates[0], localMinute: "2026-02-30T00:00" }] },
        { ...base, dates: [{ ...base.dates[0], dueAt: base.dates[0]!.dueAt + 1 }] },
    ])
        assert.throws(() => validateScheduleCalendar(changed))
    assert.throws(() => validateScheduleCalendar(f.calendar(1, f.now())))
    assert.throws(() => resolveCivilInstant("2026-03-29T02:30", "Europe/Berlin", "reject"))
    assert.throws(() => resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "reject"))
    assert.deepEqual(resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "earlier"), {
        instantAt: Date.parse("2026-10-25T00:30Z"),
        offsetMinutes: 120,
    })
    assert.deepEqual(resolveCivilInstant("2026-10-25T02:30", "Europe/Berlin", "later"), {
        instantAt: Date.parse("2026-10-25T01:30Z"),
        offsetMinutes: 60,
    })
    assert.deepEqual(resolveCivilInstant("2026-04-01T12:00", "Asia/Kathmandu", "reject"), {
        instantAt: Date.parse("2026-04-01T06:15Z"),
        offsetMinutes: 345,
    })
    assert.throws(() => resolveCivilInstant("2026-04-01T12:00", "Invalid/Synthetic", "reject"))
})

test("Non-calendar schedule edits copy frozen dates after time advances and timezone data changes", async (t) => {
    const f = await fixture(t)
    await f.open(3)
    const original = await f.show(),
        before = (await f.deliveries()).deliveries
    f.advance(180000)
    t.mock.method(Intl, "DateTimeFormat", () => {
        throw new Error("Synthetic changed timezone database")
    })
    const edited = (await f.change({ type: "content", source: f.snapshot })).schedule
    assert.deepEqual(edited.calendar, original.calendar)
    assert.equal(edited.planRevision, original.planRevision + 1)
    const rows = (await f.deliveries()).deliveries
    assert.deepEqual(
        rows.find((row) => row.deliveryId === before[0]!.deliveryId),
        before[0],
    )
    assert.deepEqual(
        rows.filter((row) => row.planRevision === edited.planRevision).map((row) => row.dueAt),
        original.calendar.dates.slice(1).map((date: any) => date.dueAt),
    )
    await f.change({ type: "destination", channelId: "30" })
    assert.deepEqual((await f.show()).calendar, original.calendar)
})

test("Schedule dates have no total cap, and edits replace unsent dates without growing", async (t) => {
    const f = await fixture(t)
    // Eight schedules of 26 dates hold more than the 200 records the old cap allowed
    for (let i = 0; i < 8; i++) await f.create(`batch-${i}`, 26)
    assert.equal(await f.stored(), 208)
    const original = await f.show(8)
    for (let i = 0; i < 3; i++) await f.change({ type: "content", source: f.snapshot }, 8)
    assert.equal(await f.stored(), 208)
    assert.deepEqual(
        (await f.show(8)).upcoming.map((date: any) => date.dueAt),
        original.upcoming.map((date: any) => date.dueAt),
    )
    assert.equal((await f.totals()).definitions, 8)
})

test("Fifty schedule definitions remain independently bounded and paginated at ten", async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.create(`notice-${i}`)
    const before = await f.totals()
    await status(
        await f.manage({
            type: "create",
            name: "notice-51",
            source: f.snapshot,
            channelId: "30",
            calendar: f.calendar(),
        }),
        429,
    )
    assert.deepEqual(await f.totals(), before)
    let cursor: number | undefined
    const numbers: number[] = []
    for (let page = 0; page < 5; page++) {
        const result = await read(
            await f.query({ type: "list", ...(cursor === undefined ? {} : { beforeScheduleNo: cursor }) }),
        )
        assert.equal(result.schedules.length, 10)
        numbers.push(...result.schedules.map((row: any) => row.scheduleNo))
        cursor = result.nextBeforeScheduleNo
    }
    assert.equal(cursor, undefined)
    assert.equal(new Set(numbers).size, 50)
})

test("Schedule show finds a schedule by its unique name", async (t) => {
    const f = await fixture(t),
        row = await f.create("notice"),
        { upcoming, ...shown } = (await read(await f.query({ type: "show", name: "Notice" }))).schedule
    assert.deepEqual(shown, row)
    assert.deepEqual(upcoming, row.calendar.dates)
    await status(await f.query({ type: "show", name: "missing" }), 404)
    for (const operation of [
        { type: "show", name: "notice", scheduleNo: row.scheduleNo },
        { type: "show", name: "not a name" },
    ])
        await status(await f.query(operation), 400)
    await status(
        await f.manage({ type: "create", name: "notice", source: f.snapshot, channelId: "30", calendar: f.calendar() }),
        409,
    )
})

test("Schedule receipts have no daily quota, need fresh sources and expire with exact counters", async (t) => {
    const f = await fixture(t)
    await f.create()
    await f.db.run(async (ctx) => {
        const state = (await ctx.db.query("scheduleSettings").collect())[0]!
        for (let i = 0; i < 999; i++)
            await ctx.db.insert("scheduleReceipts", {
                serverId: "1",
                messageId: String(200000 + i),
                actorId: "10",
                operationKey: "synthetic",
                createdAt: f.now() - 86400000,
                expiresAt: f.now(),
            })
        await ctx.db.patch(state._id, { receipts: 1000 })
    })
    // A thousand changes in a day do not stop the next one
    await f.change({ type: "disable" })
    assert.equal((await f.totals()).receipts, 1001)
    await status(
        await f.http("/schedules/manage", {
            ...f.source(),
            createdAt: f.now() - 900001,
            context: f.context(),
            operation: { type: "enable", scheduleNo: 1, expectedRevision: 2 },
        }),
        400,
    )
    await status(
        await f.http("/schedules/manage", {
            ...f.source(),
            createdAt: f.now() + 60001,
            context: f.context(),
            operation: { type: "enable", scheduleNo: 1, expectedRevision: 2 },
        }),
        400,
    )
    assert.equal((await f.cleanup()).removed, 20)
    assert.equal((await f.totals()).receipts, 981)
    assert.equal((await f.db.run((ctx) => ctx.db.query("scheduleReceipts").collect())).length, 981)
})

test("Automatic schedule reservation and claim require the bot's fresh destination rights", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!,
        valid = f.automation()
    const denied = [
        { ...valid, botAuthorized: false },
        { ...valid, channelId: "31" },
    ]
    // The contract allows only botAuthorized true, so false is malformed. A bot without rights in the channel is refused
    await status(await f.reserve(row, denied[0]), 400)
    assert.deepEqual(await read(await f.reserve(row, denied[1])), { type: "reservation", status: "waiting" })
    const grant = (await read(await f.reserve(row))).grant
    await status(await f.dispatch(grant, denied[0]), 400)
    await status(await f.dispatch(grant, denied[1]), 403)
    await status(await f.dispatch(grant, { ...valid, observedAt: f.now() - 60001 }), 400)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    assert.deepEqual(await read(await f.outcome(grant)), { recorded: true })
})

test("DEFCON gates bot automation while critical management remains usable", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!
    await f.db.run(async (ctx) => {
        const moderation = await moderationState(ctx, "1")
        await ctx.db.patch(moderation._id, { config: { ...moderation.config, defcon: 1 } })
    })
    assert.deepEqual(await read(await f.reserve(row)), { type: "reservation", status: "waiting" })
    await f.change({ type: "disable" })
    await f.change({ type: "cancel" })
    assert.equal((await f.show()).cancelled, true)
})

// DEFCON changes, what the work dispatcher lists for the schedules worker, which wakes the bot, and the posts the worker gets
function held(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const change = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    // Leaving a lower level wakes held posts in scheduled batches
    const settle = () => f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    return {
        change,
        settle,
        defcon: async (level: 1 | 2 | 3) => {
            await change(level)
            await settle()
        },
        signal: () => f.db.run(async (ctx) => (await ctx.db.query("workSignal").first())?.version ?? 0),
        due: async () => (await read(await f.http("/service/work", { cursor: null }))).kinds.schedules,
        // Every page of due posts, as the worker reads them
        list: async () => {
            const found: number[] = []
            let page
            do {
                page = await read(await f.delivery({ type: "list" }))
                found.push(...page.deliveries.map((row: SchedulesDelivery) => row.occurrenceNo))
            } while (page.hasMore)
            return found
        },
    }
}
test("Due posts wait without polling while DEFCON is below 3, come back at DEFCON 3 and still skip after their day", async (t) => {
    const f = await fixture(t)
    await f.open(2)
    const { defcon, due, list } = held(t, f)
    const [first, second] = (await f.deliveries()).deliveries
    await defcon(2)
    f.advance(first!.dueAt - f.now())
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [])
    for (let i = 0; i < 2; i++) {
        assert.deepEqual(await due(), [])
        f.advance(3600000)
    }
    assert.deepEqual(await list(), [])
    await defcon(3)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [1])
    // A post DEFCON holds for its whole local day is skipped at midnight, like any late post
    await defcon(1)
    f.advance(second!.dueAt - f.now())
    assert.deepEqual(await list(), [])
    assert.equal((await f.deliveries()).deliveries[0]!.reason, "late-window")
    f.advance(3600000)
    assert.deepEqual(await due(), [])
    f.advance(Date.parse("2026-01-03T00:00:00Z") - f.now())
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [])
    assert.equal((await f.deliveries()).deliveries[1]!.reason, "late-window")
})

// The three switches a scheduled post needs besides DEFCON
const switches = {
    schedule: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        await f.change({ type: enabled ? "enable" : "disable" })
    },
    module: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        const settings = (await read(await f.query({ type: "settings" }))).settings
        await read(await f.manage({ type: "settings", expectedRevision: settings.revision, enabled }))
    },
    publishing: (f: Awaited<ReturnType<typeof fixture>>) => async (enabled: boolean) => {
        await read(await f.publish({ type: "settings", patch: { enabled } }))
    },
}
for (const [scope, toggle] of Object.entries(switches))
    test(`Due posts wait without polling while ${scope} is off and are skipped once their day ends or it is back on`, async (t) => {
        const f = await fixture(t)
        await f.open(3)
        const { due, list } = held(t, f)
        const set = toggle(f)
        const [first, second, third] = (await f.deliveries()).deliveries
        const stored = async (row: SchedulesDelivery) =>
            (await f.db.run((ctx) => ctx.db.get(row.deliveryId as never))) as any
        await set(false)
        f.advance(first!.dueAt - f.now())
        // The bot hears of the post once and holds it until its local midnight, when it is skipped as late
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        for (let i = 0; i < 3; i++) {
            f.advance(3600000)
            assert.deepEqual(await due(), [])
        }
        assert.equal((await stored(first!)).nextCheckAt, Date.parse("2026-01-02T00:00:00Z"))
        assert.deepEqual(await list(), [])
        f.advance(Date.parse("2026-01-02T00:00:00Z") - f.now())
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        assert.equal((await f.deliveries()).deliveries[0]!.reason, "late-window")
        // Turning the switch back on cannot send a post that came due while it was off, so the next check is still its
        // midnight and it is skipped as before the activation
        f.advance(second!.dueAt - f.now())
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        f.advance(3600000)
        await set(true)
        assert.deepEqual(await due(), [])
        f.advance(Date.parse("2026-01-03T00:00:00Z") - f.now())
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [])
        assert.equal((await f.deliveries()).deliveries[1]!.reason, "activation-cutoff")
        // A post due after the switch is back on is sent
        f.advance(third!.dueAt - f.now())
        assert.deepEqual(await due(), ["1"])
        assert.deepEqual(await list(), [3])
    })

test("A held post with an open reservation comes back when its grant ends, so the reservation closes", async (t) => {
    const f = await fixture(t)
    await f.open()
    const { defcon, due, list } = held(t, f)
    f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!
    const grant = (await read(await f.reserve(row))).grant as SchedulesDeliveryGrant
    await defcon(2)
    assert.deepEqual(await list(), [])
    const stored = async () => (await f.db.run((ctx) => ctx.db.get(row.deliveryId as never))) as any
    assert.equal((await stored()).nextCheckAt, grant.dispatchExpiresAt)
    f.advance(60000)
    assert.deepEqual(await due(), [])
    f.advance(grant.dispatchExpiresAt - f.now())
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [])
    assert.equal((await stored()).active, false)
    assert.deepEqual(await due(), [])
})

test("A post woken just before local midnight reaches the bot through the work signal before it is late", async (t) => {
    const f = await fixture(t)
    const { change, settle, defcon, signal, due, list } = held(t, f)
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    const dueAt = Date.parse("2026-01-01T23:00:00Z")
    await read(
        await f.manage({
            type: "create",
            name: "evening",
            source: f.snapshot,
            channelId: "30",
            calendar: f.calendar(1, dueAt),
        }),
    )
    await f.change({ type: "enable" })
    await defcon(2)
    f.advance(dueAt - f.now())
    assert.deepEqual(await list(), [])
    f.advance(59 * 60000)
    await change(3)
    // The scheduled wake itself rings the signal, on top of the DEFCON change's own ring. The bot dispatches when the signal
    // changes, so it finds the post at 23:59 instead of after midnight
    const before = await signal()
    await settle()
    assert((await signal()) > before)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(await list(), [1])
})

test("Posts DEFCON held come back in batches across more than one page", async (t) => {
    const f = await fixture(t)
    const { defcon, due, list } = held(t, f)
    await read(await f.manage({ type: "settings", expectedRevision: 1, enabled: true }))
    const names = Array.from({ length: 21 }, (_, i) => `notice${i}`)
    for (const [i, name] of names.entries()) {
        await f.create(name)
        await f.change({ type: "enable" }, i + 1)
    }
    const expected = names.map((_, i) => i + 1)
    await defcon(2)
    f.advance(120000)
    assert.deepEqual(await list(), [])
    assert.deepEqual(await due(), [])
    await defcon(3)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual(
        (await list()).sort((a, b) => a - b),
        expected,
    )
})

test("Concurrent recovery reserves one immutable attempt and only one dispatch claim", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!
    const grants = await Promise.all([f.reserve(row), f.reserve(row)].map((response) => response.then(read)))
    assert.equal(grants[0].grant.attemptId, grants[1].grant.attemptId)
    const claims = await Promise.all(
        [f.dispatch(grants[0].grant), f.dispatch(grants[1].grant, f.automation(), "b".repeat(32))].map((response) =>
            response.then(read),
        ),
    )
    assert.equal(claims.filter((claim) => claim.claimed).length, 1)
    assert.deepEqual((await read(await f.delivery({ type: "list" }))).deliveries, [])
})

test("Only genuine activations move cutoffs and due time equal to a cutoff never dispatches", async (t) => {
    const f = await fixture(t)
    await f.open(2)
    const original = await f.show(),
        settings = (await read(await f.query({ type: "settings" }))).settings
    const rows = (await f.deliveries()).deliveries
    f.advance(120000)
    const grant = (await read(await f.reserve(rows[0]!))).grant
    await f.change({ type: "enable" })
    await read(await f.manage({ type: "settings", expectedRevision: settings.revision, enabled: true }))
    await read(await f.publish({ type: "settings", patch: { enabled: true } }))
    assert.equal((await f.show()).activatedAt, original.activatedAt)
    assert.equal((await read(await f.query({ type: "settings" }))).settings.activatedAt, settings.activatedAt)
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    await read(await f.outcome(grant))
    await f.change({ type: "disable" })
    f.advance(rows[1]!.dueAt - f.now())
    const resumed = (await f.change({ type: "enable" })).schedule
    assert.equal(resumed.activatedAt, rows[1]!.dueAt)
    assert.deepEqual(await read(await f.reserve(rows[1]!)), { type: "reservation", status: "skipped" })
    const skipped = (await f.deliveries()).deliveries[1]!
    assert.equal(skipped.reason, "activation-cutoff")
    assert.equal(skipped.attemptId, undefined)
})

test("Bounded settled forgetting releases exact quotas across pages and retains native metadata until retirement", async (t) => {
    const f = await fixture(t)
    await f.open(26)
    const rows = [...(await f.deliveries()).deliveries]
    rows.push(...(await f.deliveries(1, rows.at(-1)!.occurrenceNo)).deliveries)
    f.advance(120000)
    const grant = (await read(await f.reserve(rows[0]!))).grant
    await read(await f.dispatch(grant))
    await read(await f.outcome(grant))
    await f.change({ type: "cancel" })
    const first = await f.change({ type: "forget", confirm: "forget" })
    assert.equal(first.removed, 20)
    assert.equal(first.complete, false)
    assert.equal(await f.stored(), 6)
    const second = await f.change({ type: "forget", confirm: "forget" })
    assert.equal(second.removed, 6)
    assert.equal(second.complete, true)
    assert.equal(await f.stored(), 0)
    assert.equal((await f.totals()).definitions, 0)
    assert.deepEqual(
        await f.db.run(async (ctx) => ({
            deliveries: await ctx.db.query("scheduleDeliveries").collect(),
            posts: await ctx.db.query("publishingPosts").collect(),
            attempts: await ctx.db.query("publishingAttempts").collect(),
        })),
        { deliveries: [], posts: [], attempts: [] },
    )
})

test("Aged claims remain uncertain and history cleanup retains their ownership anchors", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const row = (await f.deliveries()).deliveries[0]!,
        grant = (await read(await f.reserve(row))).grant
    await read(await f.dispatch(grant))
    f.advance(190000)
    await read(await f.http("/publishing/observe", { serverId: "1", mode: "restart" }))
    assert.equal((await f.deliveries()).deliveries[0]!.state, "uncertain")
    await status(
        await f.manage({
            type: "forget",
            scheduleNo: 1,
            expectedRevision: (await f.show()).revision,
            confirm: "forget",
            occurrenceNos: [row.occurrenceNo],
        }),
        409,
    )
    f.advance(181 * 86400000)
    await f.cleanup()
    assert.equal(await f.stored(), 1)
    const retained = (await f.deliveries()).deliveries[0]!
    assert.equal(retained.attemptId, grant.attemptId)
    assert.equal(retained.state, "uncertain")
    assert.deepEqual(retained.content, { content: "" })
    const attempts = await f.db.run((ctx) => ctx.db.query("publishingAttempts").collect())
    assert.equal(attempts[0]!.unresolved, true)
    assert.equal(attempts[0]!.messageId, undefined)
    assert.equal(attempts[0]!.content.content, "Synthetic announcement")
})
test("History cleanup releases a schedule cancelled before its date once its last history row expires", async (t) => {
    const f = await fixture(t)
    await read(
        await f.manage({
            type: "create",
            name: "notice",
            source: f.snapshot,
            channelId: "30",
            calendar: f.calendar(1, f.now() + 30 * 86400000),
        }),
    )
    await f.change({ type: "cancel" })
    // A cancelled schedule stops counting at once, and its record goes with its last history row
    assert.equal((await f.totals()).definitions, 0)
    f.advance(180 * 86400000 + 1)
    await f.cleanup()
    assert.equal(await f.stored(), 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("schedules").collect())).length, 0)
})
test("History cleanup releases a sent post and its ended schedule after 180 days unless a role panel uses the post", async (t) => {
    const f = await fixture(t)
    await f.open()
    f.advance(120000)
    const grant = (await read(await f.reserve((await f.deliveries()).deliveries[0]!))).grant
    await read(await f.dispatch(grant))
    await read(await f.outcome(grant))
    const panel = await f.db.run((ctx) =>
        ctx.db.insert("roleReferences", {
            serverId: "1",
            consumerKey: "panel:synthetic",
            roleId: "40",
            configuration: true,
            desired: true,
            postNo: grant.postNo,
            createdAt: f.now(),
        }),
    )
    f.advance(181 * 86400000)
    await f.cleanup()
    assert.equal(await f.stored(), 1)
    await f.db.run((ctx) => ctx.db.delete(panel))
    f.advance(86400000)
    await f.cleanup()
    assert.equal(await f.stored(), 0)
    assert.equal((await f.totals()).definitions, 0)
    assert.deepEqual(
        await f.db.run(async (ctx) => ({
            schedules: await ctx.db.query("schedules").collect(),
            deliveries: await ctx.db.query("scheduleDeliveries").collect(),
            posts: await ctx.db.query("publishingPosts").collect(),
            attempts: await ctx.db.query("publishingAttempts").collect(),
        })),
        { schedules: [], deliveries: [], posts: [], attempts: [] },
    )
})
test("Late schedule occurrences still send on their local due day and skip once that day ends", async (t) => {
    const f = await fixture(t)
    await f.open(2)
    f.advance(120000 + 6 * 3600000)
    const late = (await read(await f.delivery({ type: "list" }))).deliveries
    assert.equal(late.length, 1)
    assert.equal((await read(await f.reserve(late[0]))).grant.dispatchExpiresAt, f.now() + 180000)
    f.advance(2 * 86400000)
    assert.equal((await read(await f.delivery({ type: "list" }))).deliveries.length, 0)
    const second = (await f.deliveries()).deliveries[1]!
    assert.equal(second.state, "skipped")
    assert.equal(second.reason, "late-window")
})
test("The late window ends at the next local midnight in the delivery's zone, across daylight-saving changes", () => {
    const dueAt = Date.parse("2026-01-01T20:00Z")
    assert.equal(civilDayEnded(dueAt, "Europe/Kaliningrad", Date.parse("2026-01-01T21:59Z")), false)
    assert.equal(civilDayEnded(dueAt, "Europe/Kaliningrad", Date.parse("2026-01-01T22:00Z")), true)
    assert.equal(civilDayEnded(dueAt, "America/Bogota", Date.parse("2026-01-02T04:59Z")), false)
    assert.equal(civilDayEnded(dueAt, "America/Bogota", Date.parse("2026-01-02T05:00Z")), true)
    // Berlin due March 29 00:30 CET closes at March 30 00:00 CEST, and due October 25 00:30 CEST closes at October 26 00:00 CET
    const spring = Date.parse("2026-03-28T23:30Z"),
        autumn = Date.parse("2026-10-24T22:30Z")
    assert.equal(resolveCivilInstant("2026-03-29T00:30", "Europe/Berlin", "reject").instantAt, spring)
    assert.equal(resolveCivilInstant("2026-10-25T00:30", "Europe/Berlin", "reject").instantAt, autumn)
    assert.equal(civilDayEnded(spring, "Europe/Berlin", Date.parse("2026-03-29T21:59Z")), false)
    assert.equal(civilDayEnded(spring, "Europe/Berlin", Date.parse("2026-03-29T22:00Z")), true)
    assert.equal(civilDayEnded(autumn, "Europe/Berlin", Date.parse("2026-10-25T22:59Z")), false)
    assert.equal(civilDayEnded(autumn, "Europe/Berlin", Date.parse("2026-10-25T23:00Z")), true)
})
/** A weekly UTC calendar of its first count dates, from a minute after the fixture's start */
function weekly(f: Awaited<ReturnType<typeof fixture>>, count: number, recurrence: Record<string, unknown>) {
    const first = f.now() + 120000
    return {
        localMinute: new Date(first).toISOString().slice(0, 16),
        zone: "UTC",
        fold: "reject",
        recurrence: { type: "weekly", interval: 1, ...recurrence },
        dates: Array.from({ length: count }, (_, i) => ({
            localMinute: new Date(first + i * 7 * 86400000).toISOString().slice(0, 16),
            dueAt: first + i * 7 * 86400000,
            offsetMinutes: 0,
        })),
    }
}
const WEEK = 7 * 86400000
test("An ongoing schedule keeps 26 upcoming dates as dates come due, and its numbers continue", async (t) => {
    const f = await fixture(t),
        calendar = weekly(f, 26, {})
    await read(await f.manage({ type: "create", name: "notice", source: f.snapshot, channelId: "30", calendar }))
    assert.equal((await f.show()).resume, undefined)
    for (let week = 1; week <= 3; week++) {
        f.advance(WEEK)
        await f.cleanup()
        const shown = await f.show()
        assert.equal(shown.upcoming.length, 26)
        assert.equal(shown.upcoming.at(-1).dueAt, calendar.dates[0]!.dueAt + (25 + week) * WEEK)
        // A change of the running repeat continues at its next date
        assert.deepEqual(shown.resume, { localMinute: shown.upcoming[0].localMinute })
    }
    const numbers = (await f.deliveries(1, 20)).deliveries.map((row) => row.occurrenceNo)
    assert.deepEqual(numbers, [21, 22, 23, 24, 25, 26, 27, 28, 29])
    assert.equal(await f.stored(), 29)
})
test("A quarterly repeat stores the dates within 180 days and adds each later one as the horizon reaches it", async (t) => {
    const f = await fixture(t),
        first = weekly(f, 2, {}).dates[0]!.dueAt,
        calendar = { ...weekly(f, 1, {}), recurrence: { type: "weekly", interval: 13 } }
    calendar.dates.push({
        localMinute: new Date(first + 13 * WEEK).toISOString().slice(0, 16),
        dueAt: first + 13 * WEEK,
        offsetMinutes: 0,
    })
    await read(await f.manage({ type: "create", name: "quarterly", source: f.snapshot, channelId: "30", calendar }))
    f.advance(14 * WEEK)
    await f.cleanup()
    assert.deepEqual(
        (await f.show()).upcoming.map((row: { dueAt: number }) => row.dueAt),
        [first + 26 * WEEK, first + 39 * WEEK],
    )
    // A yearly interval stores one date
    const yearly = { ...weekly(f, 1, {}), recurrence: { type: "daily", interval: 365 } }
    await read(
        await f.manage({ type: "create", name: "yearly", source: f.snapshot, channelId: "30", calendar: yearly }),
    )
    assert.equal((await f.show(2)).upcoming.length, 1)
})
test("A repeat that ends after a count or on a date stops adding dates there and stops counting", async (t) => {
    const f = await fixture(t),
        start = weekly(f, 26, {}).dates
    await read(
        await f.manage({
            type: "create",
            name: "counted",
            source: f.snapshot,
            channelId: "30",
            calendar: weekly(f, 26, { count: 27 }),
        }),
    )
    await read(
        await f.manage({
            type: "create",
            name: "dated",
            source: f.snapshot,
            channelId: "30",
            calendar: weekly(f, 26, { until: new Date(start[0]!.dueAt + 26 * WEEK).toISOString().slice(0, 10) }),
        }),
    )
    for (let week = 0; week < 3; week++) {
        f.advance(WEEK)
        await f.cleanup()
    }
    assert.equal((await f.show(1)).upcoming.length, 24)
    assert.equal((await f.show(2)).upcoming.length, 24)
    assert.equal(await f.stored(), 54)
    assert.equal((await f.totals()).definitions, 2)
    f.advance(30 * WEEK)
    await f.cleanup()
    assert.equal((await f.totals()).definitions, 0)
})
test("A later date at a time that does not exist is skipped and named, never guessed", async (t) => {
    const f = await fixture(t),
        zone = "Europe/Berlin",
        dates = Array.from({ length: 26 }, (_, i) => {
            const localMinute = `2026-03-${String(i + 1).padStart(2, "0")}T02:30`,
                resolved = resolveCivilInstant(localMinute, zone, "reject")
            return { localMinute, dueAt: resolved.instantAt, offsetMinutes: resolved.offsetMinutes }
        })
    const calendar = {
        localMinute: dates[0]!.localMinute,
        zone,
        fold: "reject",
        recurrence: { type: "daily", interval: 1 },
        dates,
    }
    await read(await f.manage({ type: "create", name: "notice", source: f.snapshot, channelId: "30", calendar }))
    f.advance(Date.parse("2026-03-03T02:00Z") - f.now())
    await f.cleanup()
    const shown = await f.show()
    assert.deepEqual(shown.lastSkipped, { localMinute: "2026-03-29T02:30", reason: "nonexistent" })
    assert.deepEqual(
        shown.upcoming.slice(-3).map((date: any) => date.localMinute),
        ["2026-03-27T02:30", "2026-03-28T02:30", "2026-03-30T02:30"],
    )
    assert.equal(shown.upcoming.at(-1).offsetMinutes, 120)
})
test("Content edits after dates were added store the same instants without asking the zone database", async (t) => {
    const f = await fixture(t)
    await read(
        await f.manage({
            type: "create",
            name: "notice",
            source: f.snapshot,
            channelId: "30",
            calendar: weekly(f, 26, {}),
        }),
    )
    f.advance(WEEK)
    await f.cleanup()
    const before = (await f.show()).upcoming
    t.mock.method(Intl, "DateTimeFormat", () => {
        throw new Error("Synthetic changed timezone database")
    })
    const edited = await f.change({ type: "content", source: f.snapshot })
    assert.equal(edited.schedule.planRevision, 2)
    assert.deepEqual((await f.show()).upcoming, before)
})
test("Cancelling ends adding dates and frees the schedule's place among the 50", async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.create(`notice-${i}`, i === 0 ? 2 : 1)
    const create = () =>
        f.manage({ type: "create", name: "extra", source: f.snapshot, channelId: "30", calendar: f.calendar() })
    await status(await create(), 429)
    await f.change({ type: "cancel" })
    assert.equal((await f.totals()).definitions, 49)
    await read(await create())
    const cancelled = await f.db.run((ctx) =>
        ctx.db
            .query("schedules")
            .withIndex("by_number", (q) => q.eq("serverId", "1").eq("scheduleNo", 1))
            .unique(),
    )
    assert.equal(cancelled!.extendAt, undefined)
    f.advance(WEEK)
    await f.cleanup()
    assert.equal(
        (await f.deliveries()).deliveries.every((row) => row.state === "cancelled"),
        true,
    )
})
test("Cancelled and finished schedules stored before they stopped counting leave room for live ones", async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.create(`notice-${i}`)
    // The old rule kept a cancelled or finished schedule counted, without storing when it extends, until it was forgotten
    await f.db.run(async (ctx) => {
        for (const scheduleNo of [1, 2]) {
            const row = await ctx.db
                .query("schedules")
                .withIndex("by_number", (q) => q.eq("serverId", "1").eq("scheduleNo", scheduleNo))
                .unique()
            await ctx.db.patch(row!._id, {
                ...(scheduleNo === 1 ? { cancelled: true, enabled: false } : {}),
                extendAt: undefined,
                nextIndex: undefined,
            })
            for (const delivery of await ctx.db
                .query("scheduleDeliveries")
                .withIndex("by_schedule_occurrence", (q) => q.eq("serverId", "1").eq("scheduleNo", scheduleNo))
                .collect())
                await ctx.db.patch(delivery._id, { active: false })
        }
    })
    assert.equal((await f.totals()).definitions, 48)
    const create = (name: string) =>
        f.manage({ type: "create", name, source: f.snapshot, channelId: "30", calendar: f.calendar() })
    await read(await create("first"))
    await read(await create("second"))
    await status(await create("third"), 429)
    assert.equal((await f.totals()).definitions, 50)
})
test("A schedule whose dates have all come due no longer counts toward the 50", async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.create(`notice-${i}`)
    f.advance(86400000)
    await f.cleanup()
    await f.cleanup()
    await f.cleanup()
    assert.equal((await f.totals()).definitions, 0)
    await read(
        await f.manage({ type: "create", name: "later", source: f.snapshot, channelId: "30", calendar: f.calendar() }),
    )
    // A new calendar on a schedule that ran out counts it again
    await f.change({ type: "calendar", calendar: f.calendar() })
    assert.equal((await f.totals()).definitions, 2)
})
