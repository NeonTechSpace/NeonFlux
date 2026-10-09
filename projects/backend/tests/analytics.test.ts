import assert from "node:assert/strict"
import { test, beforeEach, afterEach, mock } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"

const modules = {
    "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/analytics.ts": () => import("../convex/analytics.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const prior = { ...process.env }
const DAY = 86400000
// 2026-10-09T15:30:00Z
const now = Date.UTC(2026, 9, 9, 15, 30), today = Date.UTC(2026, 9, 9)
let permission = "32"
beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    permission = "32"
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    delete process.env.NEONFLUX_SERVER_MODE; delete process.env.NEONFLUX_SERVER_IDS
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-provider-token")
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Test member", bot: false, system: false } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Test server", icon: null, owner_id: "99", permissions: permission }])
        throw new Error("Unexpected synthetic provider route")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "FLUXER_CLIENT_ID"]) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
    }
})
const backend = () => convexTest({ schema, modules, transactionLimits: true })

const hoursWith = (...entries: Array<[number, number]>) => { const hours = Array.from({ length: 24 }, () => 0); for (const [hour, count] of entries) hours[hour] = count; return hours }
const zero = hoursWith()

test("the analytics dashboard query returns zero-filled day series, hours and top channels for the chosen range", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    await t.run(async ctx => {
        await ctx.db.insert("analyticsDays", { serverId: "10", day: today, joins: 3, leaves: 1 })
        await ctx.db.insert("analyticsDays", { serverId: "10", day: today - 29 * DAY, joins: 1, leaves: 2 })
        await ctx.db.insert("analyticsDays", { serverId: "10", day: today - 30 * DAY, joins: 9, leaves: 9 })
        await ctx.db.insert("analyticsDays", { serverId: "11", day: today, joins: 50, leaves: 50 })
        // A day row after today, as a bot clock running ahead could write, stays out of every range
        await ctx.db.insert("analyticsDays", { serverId: "10", day: today + DAY, joins: 70, leaves: 70 })
        const days: Array<[number, Array<[string, number, number]>]> = [[today, [["50", 9, 7]]], [today - DAY, [["51", 18, 4]]], [today - 13 * DAY, [["50", 9, 2]]], [today - 14 * DAY, [["53", 0, 1]]], [today - 20 * DAY, [["52", 20, 40]]]]
        for (const [day, channels] of days) {
            await ctx.db.insert("analyticsMessageDays", { serverId: "10", day, count: channels.reduce((sum, [, , count]) => sum + count, 0),
                hours: hoursWith(...channels.map(([, hour, count]) => [hour, count] as [number, number])), channels: channels.map(([channelId, , count]) => ({ channelId, count })) })
            for (const [channelId, hour, count] of channels) await ctx.db.insert("analyticsChannelDays", { serverId: "10", channelId, day, count, hours: hoursWith([hour, count]) })
        }
        await ctx.db.insert("analyticsMessageDays", { serverId: "11", day: today, count: 99, hours: hoursWith([9, 99]), channels: [{ channelId: "60", count: 99 }] })
        await ctx.db.insert("analyticsChannelDays", { serverId: "11", channelId: "50", day: today, count: 99, hours: hoursWith([9, 99]) })
    })
    const week = await t.query(api.analytics.dashboard, { ...args, range: 7 })
    assert.equal(week.serverId, "10"); assert.equal(week.enabled, true); assert.equal(week.revision, 0); assert.equal(week.range, 7)
    assert.equal(week.members.length, 30)
    assert.deepEqual(week.members[0], { day: today - 29 * DAY, joins: 1, leaves: 2 })
    assert.deepEqual(week.members[29], { day: today, joins: 3, leaves: 1 })
    assert.deepEqual(week.members[15], { day: today - 14 * DAY, joins: 0, leaves: 0 })
    assert.equal(week.messages.length, 14)
    assert.deepEqual([week.messages[0], week.messages[12], week.messages[13]], [{ day: today - 13 * DAY, count: 2 }, { day: today - DAY, count: 4 }, { day: today, count: 7 }])
    assert.deepEqual(week.topChannels, [{ channelId: "50", count: 7 }, { channelId: "51", count: 4 }])
    assert.equal(week.channelId, null)
    assert.deepEqual(week.hours.map(row => row.day), Array.from({ length: 7 }, (_, index) => today - (6 - index) * DAY))
    assert.deepEqual([week.hours[0]!.counts, week.hours[5]!.counts, week.hours[6]!.counts], [zero, hoursWith([18, 4]), hoursWith([9, 7])])
    const month = await t.query(api.analytics.dashboard, { ...args, range: 30 })
    assert.deepEqual(month.topChannels, [{ channelId: "52", count: 40 }, { channelId: "50", count: 9 }, { channelId: "51", count: 4 }, { channelId: "53", count: 1 }])
    assert.deepEqual(month.members, week.members); assert.deepEqual(month.messages, week.messages)
    assert.equal(month.hours.length, 30)
    assert.deepEqual([month.hours[9]!.counts, month.hours[15]!.counts], [hoursWith([20, 40]), hoursWith([0, 1])])
    // One channel's hours come from its own day rows, and the rest of the snapshot stays server wide
    const channel = await t.query(api.analytics.dashboard, { ...args, range: 30, channelId: "50" })
    assert.equal(channel.channelId, "50")
    assert.deepEqual(channel.topChannels, month.topChannels); assert.deepEqual(channel.messages, month.messages)
    assert.deepEqual(channel.hours.filter(row => row.counts.some(Boolean)).map(row => [row.day, row.counts]), [[today - 13 * DAY, hoursWith([9, 2])], [today, hoursWith([9, 7])]])
    assert.deepEqual(channel.hours[27], { day: today - 2 * DAY, counts: zero })
    await assert.rejects(t.query(api.analytics.dashboard, { ...args, range: 7, channelId: "not-an-id" }))
    await assert.rejects(t.query(api.analytics.dashboard, { ...args, serverId: "11", range: 7 }))
    await assert.rejects(t.query(api.analytics.dashboard, { ...args, range: 14 as 7 }))
})

test("a server with a thousand active channels a day reads one message row per day and keeps its newest days", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    // 35 days of 1,000 channels each are 35,000 channel days, more than the old 8,000 row read bound
    await t.run(async ctx => {
        for (let index = 0; index < 35; index++) {
            const day = today - index * DAY, channels = Array.from({ length: 1000 }, (_, channel) => ({ channelId: String(1000 + channel), count: channel === 999 ? 1000 + index : 1 }))
            await ctx.db.insert("analyticsMessageDays", { serverId: "10", day, count: channels.reduce((sum, row) => sum + row.count, 0), hours: hoursWith([12, 1]), channels })
        }
    })
    const month = await t.query(api.analytics.dashboard, { ...args, range: 30 })
    assert.deepEqual(month.messages.at(-1), { day: today, count: 1999 })
    assert.deepEqual(month.messages[0], { day: today - 13 * DAY, count: 2012 })
    assert.deepEqual(month.topChannels.slice(0, 2), [{ channelId: "1999", count: 30 * 1000 + 435 }, { channelId: "1000", count: 30 }])
    assert.deepEqual(month.hours.map(row => row.counts[12]), Array.from({ length: 30 }, () => 1))
})

test("the website toggle saves with a revision, rejects stale drafts and rechecks Manage Server access", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    assert.deepEqual(await t.action(api.analytics.save, { ...args, expectedRevision: 0, enabled: false }), { saved: true, revision: 1 })
    const off = await t.query(api.analytics.dashboard, { ...args, range: 7 })
    assert.equal(off.enabled, false); assert.equal(off.revision, 1)
    assert.deepEqual(await t.action(api.analytics.save, { ...args, expectedRevision: 0, enabled: true }), { saved: false, conflict: true, revision: 1 })
    assert.deepEqual(await t.action(api.analytics.save, { ...args, expectedRevision: 1, enabled: true }), { saved: true, revision: 2 })
    const rows = await t.run(ctx => ctx.db.query("analyticsSettings").collect())
    assert.deepEqual(rows.map(row => [row.serverId, row.enabled, row.revision, row.updatedBy, row.updatedAt]), [["10", true, 2, "20", now]])
    permission = "0"
    await assert.rejects(t.action(api.analytics.save, { ...args, expectedRevision: 2, enabled: false }))
    assert.equal((await t.run(ctx => ctx.db.query("analyticsSettings").collect()))[0]!.enabled, true)
})
