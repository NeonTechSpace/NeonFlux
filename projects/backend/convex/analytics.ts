import { v } from "convex/values"
import { action, internalMutation, internalQuery, query } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { AnalyticsRecordResult, AnalyticsSettings, AnalyticsSummary } from "../contracts.js"
import type { DashboardAnalyticsSnapshot, DashboardSaveResult } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { verifyProvider } from "./dashboardProvider.ts"
import { fail, isId, object } from "./validation.ts"
import { addHours, analyticsRecord, busiestHours, CHANNEL_RETENTION_MS, DAY_MS, DAY_RETENTION_MS, dayStart, FLUSH_RETENTION_MS, groupHours, mergeChannels, storedHours, topChannels }
    from "./analyticsDomain.ts"

// Counts only. No row names a member, and every row is one aggregated bucket
const readSettings = (ctx: QueryCtx | MutationCtx, serverId: string) => ctx.db.query("analyticsSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
const enabledFor = async (ctx: QueryCtx | MutationCtx, serverId: string) => (await readSettings(ctx, serverId))?.enabled ?? true
// Range reads hold one row per UTC day from `from` to `to`, so they read at most one row per day. Newest first, so the bound can never drop recent days
const days = (from: number, to: number) => (to - from) / DAY_MS + 1
const serverDays = (ctx: QueryCtx, serverId: string, from: number, to: number) =>
    ctx.db.query("analyticsDays").withIndex("by_bucket", q => q.eq("serverId", serverId).gte("day", from).lte("day", to)).order("desc").take(days(from, to))
const messageDays = (ctx: QueryCtx, serverId: string, from: number, to: number) =>
    ctx.db.query("analyticsMessageDays").withIndex("by_server", q => q.eq("serverId", serverId).gte("day", from).lte("day", to)).order("desc").take(days(from, to))
const channelDays = (ctx: QueryCtx, serverId: string, channelId: string, from: number, to: number) =>
    ctx.db.query("analyticsChannelDays").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId).gte("day", from).lte("day", to)).order("desc").take(days(from, to))

async function writeEnabled(ctx: MutationCtx, serverId: string, actorId: string, enabled: boolean, expectedRevision?: number): Promise<DashboardSaveResult> {
    const old = await readSettings(ctx, serverId), revision = old?.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== revision) return { saved: false, conflict: true, revision }
    if (old?.enabled === enabled || !old && enabled) return { saved: true, revision }
    const next = { enabled, revision: revision + 1, updatedAt: Date.now(), updatedBy: actorId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("analyticsSettings", { serverId, ...next })
    return { saved: true, revision: next.revision }
}

export const settings = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AnalyticsSettings> => ({ enabled: await enabledFor(ctx, String(object(request).serverId)) }) })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AnalyticsSettings> => {
    const input = object(request)
    if (input.managerAuthorized !== true || !isId(input.actorId)) fail(403, "Manage Server permission required")
    if (typeof input.enabled !== "boolean") fail(400, "Invalid request")
    await writeEnabled(ctx, String(input.serverId), input.actorId, input.enabled)
    return { enabled: input.enabled }
} })

// One flush adds each hourly bucket to its channel day row and its server day row, so later reads take one row per day
export const record = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AnalyticsRecordResult> => {
    const serverId = String(object(request).serverId), now = Date.now(), batch = analyticsRecord(request, now)
    if (!await enabledFor(ctx, serverId)) return { enabled: false, recorded: false }
    // A batch at or below the session's applied sequence was saved before, and only its reply was lost
    const flush = await ctx.db.query("analyticsFlushes").withIndex("by_session", q => q.eq("serverId", serverId).eq("session", batch.session)).unique()
    if (flush && batch.sequence <= flush.sequence) return { enabled: true, recorded: true }
    if (flush) await ctx.db.patch(flush._id, { sequence: batch.sequence, updatedAt: now })
    else await ctx.db.insert("analyticsFlushes", { serverId, session: batch.session, sequence: batch.sequence, updatedAt: now })
    const grouped = groupHours(batch.hours)
    for (const bucket of grouped.channels) {
        const row = await ctx.db.query("analyticsChannelDays").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", bucket.channelId).eq("day", bucket.day)).unique()
        if (row) await ctx.db.patch(row._id, { count: row.count + bucket.count, hours: addHours(row.hours, bucket.hours) })
        else await ctx.db.insert("analyticsChannelDays", { serverId, ...bucket })
    }
    for (const bucket of grouped.days) {
        const row = await ctx.db.query("analyticsMessageDays").withIndex("by_server", q => q.eq("serverId", serverId).eq("day", bucket.day)).unique()
        if (row) await ctx.db.patch(row._id, { count: row.count + bucket.count, hours: addHours(row.hours, bucket.hours), channels: mergeChannels(row.channels, bucket.channels) })
        else await ctx.db.insert("analyticsMessageDays", { serverId, day: bucket.day, count: bucket.count, hours: bucket.hours, channels: mergeChannels([], bucket.channels) })
    }
    for (const bucket of batch.days) {
        const row = await ctx.db.query("analyticsDays").withIndex("by_bucket", q => q.eq("serverId", serverId).eq("day", bucket.day)).unique()
        if (row) await ctx.db.patch(row._id, { joins: row.joins + bucket.joins, leaves: row.leaves + bucket.leaves })
        else await ctx.db.insert("analyticsDays", { serverId, ...bucket })
    }
    return { enabled: true, recorded: true }
} })

// At most seven server day rows and seven message day rows
export const summary = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AnalyticsSummary> => {
    const serverId = String(object(request).serverId), today = dayStart(Date.now()), since = today - 6 * DAY_MS
    const members = await serverDays(ctx, serverId, since, today), messages = await messageDays(ctx, serverId, since, today)
    return { enabled: await enabledFor(ctx, serverId), since, joins: members.reduce((sum, row) => sum + row.joins, 0), leaves: members.reduce((sum, row) => sum + row.leaves, 0),
        messages: messages.reduce((sum, row) => sum + row.count, 0), topChannels: topChannels(messages.flatMap(row => row.channels), 3), busiestHours: busiestHours(messages, 3) }
} })

// At most 30 server day rows, 30 message day rows and, for one channel's hours, 30 channel day rows
export const dashboard = query({ args: { sessionToken: v.string(), serverId: v.string(), range: v.union(v.literal(7), v.literal(30)), channelId: v.optional(v.string()) }, handler: async (ctx, input): Promise<DashboardAnalyticsSnapshot> => {
    await dashboardSession(ctx, input.sessionToken, input.serverId)
    if (input.channelId !== undefined && !isId(input.channelId)) fail(400, "Invalid channel")
    const today = dayStart(Date.now()), rangeStart = today - (input.range - 1) * DAY_MS, settings = await readSettings(ctx, input.serverId)
    const members = new Map((await serverDays(ctx, input.serverId, today - 29 * DAY_MS, today)).map(row => [row.day, row]))
    const messageRows = await messageDays(ctx, input.serverId, today - (Math.max(input.range, 14) - 1) * DAY_MS, today)
    const messages = new Map(messageRows.map(row => [row.day, row.count])), inRange = messageRows.filter(row => row.day >= rangeStart)
    const hourRows = input.channelId === undefined ? inRange : await channelDays(ctx, input.serverId, input.channelId, rangeStart, today)
    const hours = new Map(hourRows.map(row => [row.day, row.hours]))
    // Oldest first and zero-filled, ending today
    const series = (length: number) => Array.from({ length }, (_, index) => today - (length - 1 - index) * DAY_MS)
    return { serverId: input.serverId, enabled: settings?.enabled ?? true, revision: settings?.revision ?? 0,
        members: series(30).map(day => { const row = members.get(day); return { day, joins: row?.joins ?? 0, leaves: row?.leaves ?? 0 } }),
        messages: series(14).map(day => ({ day, count: messages.get(day) ?? 0 })),
        range: input.range, topChannels: topChannels(inRange.flatMap(row => row.channels), 10),
        channelId: input.channelId ?? null, hours: series(input.range).map(day => ({ day, counts: storedHours(hours.get(day)) })) }
} })

const saveArgs = { sessionToken: v.string(), serverId: v.string(), expectedRevision: v.number(), enabled: v.boolean() }
export const applyDashboard = internalMutation({ args: saveArgs, handler: async (ctx, input): Promise<DashboardSaveResult> => {
    const stored = await dashboardSession(ctx, input.sessionToken, input.serverId)
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, "Invalid settings revision")
    return writeEnabled(ctx, input.serverId, stored.userId, input.enabled, input.expectedRevision)
} })
// The website toggle rechecks current Manage Server access with the provider before it saves
export const save = action({ args: saveArgs, handler: async (ctx, input): Promise<DashboardSaveResult> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: input.sessionToken })
    const identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === input.serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken: input.sessionToken })
        fail(403, "Manage Server permission required")
    }
    await ctx.runMutation(internal.dashboard.renew, { sessionToken: input.sessionToken, user: identity.user, servers: identity.servers })
    return ctx.runMutation(internal.analytics.applyDashboard, input)
} })

// Bounded retention. A full batch schedules one immediate follow-up so a large backlog drains without a larger transaction
const PRUNE_BATCH = 512
// Message day rows can list many channels, so fewer of them fit one transaction
const PRUNE_MESSAGE_BATCH = 128
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    // A row goes once its whole bucket is older than its retention
    const now = Date.now()
    const channels = await ctx.db.query("analyticsChannelDays").withIndex("by_day", q => q.lt("day", now - CHANNEL_RETENTION_MS - DAY_MS)).take(PRUNE_BATCH)
    const messages = await ctx.db.query("analyticsMessageDays").withIndex("by_day", q => q.lt("day", now - CHANNEL_RETENTION_MS - DAY_MS)).take(PRUNE_MESSAGE_BATCH)
    const days = await ctx.db.query("analyticsDays").withIndex("by_day", q => q.lt("day", now - DAY_RETENTION_MS - DAY_MS)).take(PRUNE_BATCH)
    const flushes = await ctx.db.query("analyticsFlushes").withIndex("by_updated", q => q.lt("updatedAt", now - FLUSH_RETENTION_MS)).take(PRUNE_BATCH)
    for (const row of [...channels, ...messages, ...days, ...flushes]) await ctx.db.delete(row._id)
    const more = [channels, days, flushes].some(rows => rows.length === PRUNE_BATCH) || messages.length === PRUNE_MESSAGE_BATCH
    if (more) await ctx.scheduler.runAfter(0, internal.analytics.cleanup, {})
    return { channels: channels.length, messages: messages.length, days: days.length, flushes: flushes.length, more }
} })
