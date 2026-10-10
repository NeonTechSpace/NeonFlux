import assert from "node:assert/strict"
import nodeTest, { type TestContext } from "node:test"
import { makeFunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import type { AnalyticsDayBucket, AnalyticsHourBucket, AnalyticsManageRequest, AnalyticsRecordRequest, AnalyticsRecordResult, AnalyticsSummary } from "@neonflux/contracts/analytics"
import { adapterFixture } from "./adapter-fixture.ts"
import { createAnalyticsStore, AnalyticsStoreError } from "../../bot/src/analytics-store.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const HOUR = 3600000, DAY = 86400000
const modules = { "../convex/analytics.ts": () => import("../convex/analytics.ts") }
const session = "synthetic-session-1"
const hoursWith = (...entries: Array<[number, number]>) => { const hours = Array.from({ length: 24 }, () => 0); for (const [hour, count] of entries) hours[hour] = count; return hours }

async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    const store = createAnalyticsStore(f.config), hour = Math.floor(f.now() / HOUR) * HOUR, day = Math.floor(f.now() / DAY) * DAY, hourOfDay = (hour - day) / HOUR
    let sequence = 0
    const request = (hours: AnalyticsHourBucket[], days: AnalyticsDayBucket[] = []): AnalyticsRecordRequest => ({ serverId: "1", session, sequence: ++sequence, hours, days })
    const record = (hours: AnalyticsHourBucket[], days: AnalyticsDayBucket[] = []) => f.run<AnalyticsRecordResult>(store.record(request(hours, days)))
    const rows = () => f.backend.run(async ctx => ({
        channels: (await ctx.db.query("analyticsChannelDays").collect()).map(({ channelId, day, count, hours }) => ({ channelId, day, count, hours })),
        messages: (await ctx.db.query("analyticsMessageDays").collect()).map(({ day, count, hours, channels }) => ({ day, count, hours, channels })),
        days: (await ctx.db.query("analyticsDays").collect()).map(({ day, joins, leaves }) => ({ day, joins, leaves })),
    }))
    return { ...f, store, hour, day, hourOfDay, request, record, rows }
}

test("flushes add hourly buckets to channel day and server day rows, merge repeated buckets and summarize the busiest hours", async t => {
    const f = await fixture(t)
    // The previous hour is yesterday when the fixture clock sits in the first hour of a day
    const earlier = f.hour - HOUR, earlierDay = Math.floor(earlier / DAY) * DAY, earlierHour = (earlier - earlierDay) / HOUR
    assert.deepEqual(await f.record([{ channelId: "30", hour: f.hour, count: 3 }, { channelId: "30", hour: f.hour, count: 1 }, { channelId: "31", hour: earlier, count: 2 }], [{ day: f.day, joins: 2, leaves: 0 }]), { enabled: true, recorded: true })
    assert.deepEqual(await f.record([{ channelId: "30", hour: f.hour, count: 5 }], [{ day: f.day, joins: 1, leaves: 1 }]), { enabled: true, recorded: true })
    const stored = await f.rows()
    assert.deepEqual(stored.channels.sort((a, b) => a.channelId.localeCompare(b.channelId)), [
        { channelId: "30", day: f.day, count: 9, hours: hoursWith([f.hourOfDay, 9]) },
        { channelId: "31", day: earlierDay, count: 2, hours: hoursWith([earlierHour, 2]) },
    ])
    const expected = earlierDay === f.day ? [{ day: f.day, count: 11, hours: hoursWith([earlierHour, 2], [f.hourOfDay, 9]), channels: [{ channelId: "30", count: 9 }, { channelId: "31", count: 2 }] }]
        : [{ day: earlierDay, count: 2, hours: hoursWith([earlierHour, 2]), channels: [{ channelId: "31", count: 2 }] }, { day: f.day, count: 9, hours: hoursWith([f.hourOfDay, 9]), channels: [{ channelId: "30", count: 9 }] }]
    assert.deepEqual(stored.messages.sort((a, b) => a.day - b.day), expected)
    assert.deepEqual(stored.days, [{ day: f.day, joins: 3, leaves: 1 }])
    // One backend call per flush
    assert.deepEqual(f.calls.map(call => [call.path, call.status]), [["/analytics/record", 200], ["/analytics/record", 200]])
    const summary = await f.run<AnalyticsSummary>(f.store.summary({ serverId: "1" }))
    assert.deepEqual(summary, { enabled: true, since: f.day - 6 * DAY, joins: 3, leaves: 1, onboarded: 0, messages: 11, topChannels: [{ channelId: "30", count: 9 }, { channelId: "31", count: 2 }],
        busiestHours: [{ hour: f.hourOfDay, count: 9 }, { hour: earlierHour, count: 2 }] })
})

test("a batch resent after its reply was lost is counted once, and each session keeps its own sequence", async t => {
    const f = await fixture(t)
    // The backend saves the first flush, then its reply is lost on the way back
    let lost = 1
    f.afterApplied(path => { if (path === "/analytics/record" && lost-- > 0) throw new ConvexError({ status: 503, error: "Unavailable" }) })
    const first = f.request([{ channelId: "30", hour: f.hour, count: 4 }], [{ day: f.day, joins: 1, leaves: 0 }])
    await f.reject(f.store.record(first), AnalyticsStoreError, 503)
    assert.deepEqual(await f.run(f.store.record(first)), { enabled: true, recorded: true })
    assert.deepEqual(await f.record([{ channelId: "30", hour: f.hour, count: 1 }]), { enabled: true, recorded: true })
    // A batch at or below the applied sequence is acknowledged without counting it
    assert.deepEqual(await f.run(f.store.record(first)), { enabled: true, recorded: true })
    let stored = await f.rows()
    assert.deepEqual([stored.channels[0]!.count, stored.messages[0]!.count, stored.days[0]!.joins], [5, 5, 1])
    // Another worker run starts its own sequence
    assert.deepEqual(await f.run(f.store.record({ ...first, session: "synthetic-session-2" })), { enabled: true, recorded: true })
    stored = await f.rows()
    assert.deepEqual([stored.channels[0]!.count, stored.messages[0]!.count, stored.days[0]!.joins], [9, 9, 2])
    const flushes = await f.backend.run(ctx => ctx.db.query("analyticsFlushes").collect())
    assert.deepEqual(flushes.map(row => [row.serverId, row.session, row.sequence, row.updatedAt]).sort(), [["1", "synthetic-session-1", 2, f.now()], ["1", "synthetic-session-2", 1, f.now()]])
})

test("analytics off stores nothing and keeps existing rows, and on resumes recording", async t => {
    const f = await fixture(t)
    await f.record([{ channelId: "30", hour: f.hour, count: 1 }])
    assert.deepEqual(await f.run(f.store.settings({ serverId: "1" })), { enabled: true })
    assert.deepEqual(await f.run(f.store.manage({ serverId: "1", originServerId: "1", actorId: "10", managerAuthorized: true, enabled: false })), { enabled: false })
    assert.deepEqual(await f.record([{ channelId: "30", hour: f.hour, count: 4 }], [{ day: f.day, joins: 1, leaves: 0 }]), { enabled: false, recorded: false })
    assert.deepEqual(await f.rows(), { channels: [{ channelId: "30", day: f.day, count: 1, hours: hoursWith([f.hourOfDay, 1]) }],
        messages: [{ day: f.day, count: 1, hours: hoursWith([f.hourOfDay, 1]), channels: [{ channelId: "30", count: 1 }] }], days: [] })
    assert.equal((await f.run<AnalyticsSummary>(f.store.summary({ serverId: "1" }))).enabled, false)
    await f.run(f.store.manage({ serverId: "1", originServerId: "1", actorId: "10", managerAuthorized: true, enabled: true }))
    await f.record([{ channelId: "30", hour: f.hour, count: 4 }])
    assert.equal((await f.rows()).channels[0]!.count, 5)
    const settings = await f.backend.run(ctx => ctx.db.query("analyticsSettings").collect())
    assert.deepEqual(settings.map(row => [row.enabled, row.revision, row.updatedBy]), [[true, 2, "10"]])
    // The contract allows only managerAuthorized true, so false is malformed. The bot refuses members without Manage Server before it asks
    await f.reject(f.store.manage({ serverId: "1", actorId: "10", managerAuthorized: false, enabled: false } as unknown as AnalyticsManageRequest), AnalyticsStoreError, 400)
})

test("flushes outside the bucket rules, without a batch identity or over 500 buckets are refused without writes", async t => {
    const f = await fixture(t)
    const many = Array.from({ length: 501 }, (_, index) => ({ channelId: String(100 + index), hour: f.hour, count: 1 }))
    const valid = { serverId: "1", session, sequence: 1, hours: [{ channelId: "30", hour: f.hour, count: 1 }], days: [] }
    for (const request of [
        { ...valid, hours: many },
        { ...valid, hours: [{ channelId: "30", hour: f.hour + 1, count: 1 }] },
        { ...valid, hours: [{ channelId: "30", hour: f.hour, count: 0 }] },
        { ...valid, hours: [] },
        { ...valid, hours: [], days: [{ day: f.day, joins: 0, leaves: 0 }] },
        { ...valid, hours: [{ channelId: "30", hour: f.hour - 40 * DAY, count: 1 }] },
        { ...valid, session: "" },
        { ...valid, session: "not a token" },
        { ...valid, sequence: 0 },
        { ...valid, sequence: 1.5 },
    ]) await f.reject(f.store.record(request), AnalyticsStoreError, 400)
    await f.reject(f.store.record({ ...valid, serverId: "2" }), AnalyticsStoreError, 403)
    assert.deepEqual(await f.rows(), { channels: [], messages: [], days: [] })
    assert.equal((await f.backend.run(ctx => ctx.db.query("analyticsFlushes").collect())).length, 0)
    // Exactly 500 buckets fit one request
    assert.deepEqual(await f.record(many.slice(0, 500)), { enabled: true, recorded: true })
    const stored = await f.rows()
    assert.equal(stored.channels.length, 500)
    assert.deepEqual([stored.messages.length, stored.messages[0]!.count, stored.messages[0]!.channels.length], [1, 500, 500])
})

test("retention prunes channel and message days after 35 days, server days after 400 days and batch records after two days", async t => {
    const f = await fixture(t)
    const day = f.day
    await f.backend.run(async ctx => {
        for (const [channelId, at] of [["30", day - 37 * DAY], ["31", day - 34 * DAY]] as const) await ctx.db.insert("analyticsChannelDays", { serverId: "1", channelId, day: at, count: 1, hours: hoursWith([0, 1]) })
        for (const at of [day - 37 * DAY, day - 34 * DAY]) await ctx.db.insert("analyticsMessageDays", { serverId: "1", day: at, count: 1, hours: hoursWith([0, 1]), channels: [{ channelId: "30", count: 1 }] })
        for (const at of [day - 402 * DAY, day - 399 * DAY, day]) await ctx.db.insert("analyticsDays", { serverId: "1", day: at, joins: 1, leaves: 0 })
        for (const [name, at] of [["synthetic-old", f.now() - 2 * DAY - 1], ["synthetic-recent", f.now() - 2 * DAY + 1]] as const) await ctx.db.insert("analyticsFlushes", { serverId: "1", session: name, sequence: 3, updatedAt: at })
    })
    const result = await f.backend.mutation(makeFunctionReference<"mutation">("analytics:cleanup"), {})
    assert.deepEqual(result, { channels: 1, messages: 1, days: 1, flushes: 1, more: false })
    const stored = await f.rows()
    assert.deepEqual(stored.channels.map(row => row.channelId), ["31"])
    assert.deepEqual(stored.messages.map(row => row.day), [day - 34 * DAY])
    assert.deepEqual(stored.days.map(row => row.day).sort(), [day - 399 * DAY, day])
    assert.deepEqual((await f.backend.run(ctx => ctx.db.query("analyticsFlushes").collect())).map(row => row.session), ["synthetic-recent"])
})
