import { v } from "convex/values"
import { action, internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import type { DashboardMessageJob } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { verifyProvider } from "./dashboardProvider.ts"
import { publishingContent, shape } from "./publishingDomain.ts"
import { reservePublishing, publicAttempt, age } from "./publishing.ts"
import { fail, requireId, integer } from "./validation.ts"

export function publicDashboardMessageJob(row: Doc<"dashboardMessageJobs">): DashboardMessageJob {
    return { id: row._id, actorId: row.actorId, channelId: row.channelId, content: row.content, state: row.state, createdAt: row.createdAt, expiresAt: row.expiresAt,
        ...(row.error ? { error: row.error } : {}), ...(row.messageId ? { messageId: row.messageId } : {}) }
}
const args = { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), channelId: v.string(), content: v.any() }
function contentKey(value: unknown): string {
    const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, ordered(nested)])) : item
    return JSON.stringify(ordered(value))
}
export const queue = action({ args, handler: async (ctx, input): Promise<{ jobId: string }> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: input.sessionToken }), identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === input.serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken: input.sessionToken })
        fail(403, "Manage Server permission required")
    }
    await ctx.runMutation(internal.dashboard.renew, { sessionToken: input.sessionToken, user: identity.user, servers: identity.servers })
    return ctx.runMutation(internal.dashboardMessages.enqueue, input)
} })
export const enqueue = internalMutation({ args, handler: async (ctx, input): Promise<{ jobId: string }> => {
    const session = await dashboardSession(ctx, input.sessionToken, input.serverId), content = publishingContent(input.content, true), channelId = requireId(input.channelId)
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)) fail(400, "Invalid message request")
    const previous = await ctx.db.query("dashboardMessageJobs").withIndex("by_request", q => q.eq("sessionId", session._id).eq("serverId", input.serverId).eq("requestId", input.requestId)).unique()
    if (previous) {
        if (previous.channelId !== channelId || contentKey(previous.content) !== contentKey(content)) fail(409, "Message request already used")
        return { jobId: previous._id }
    }
    await policy(ctx, input.serverId)
    const pending = await ctx.db.query("dashboardMessageJobs").withIndex("by_work", q => q.eq("serverId", input.serverId).eq("state", "queued")).take(4)
    const reserved = await ctx.db.query("dashboardMessageJobs").withIndex("by_work", q => q.eq("serverId", input.serverId).eq("state", "reserved")).take(4)
    if (pending.length + reserved.length >= 4) fail(429, "Four messages are already waiting to send. Try again when they finish")
    const now = Date.now(), expiresAt = Math.min(now + 120000, session.expiresAt)
    const id = await ctx.db.insert("dashboardMessageJobs", { serverId: input.serverId, actorId: session.userId, sessionId: session._id, requestId: input.requestId, channelId, content, state: "queued", createdAt: now, expiresAt, cleanupAt: now + 86400000 })
    await ctx.scheduler.runAt(expiresAt + 10000, internal.dashboardMessages.expire, { id })
    await ctx.scheduler.runAt(now + 86400000, internal.dashboardMessages.cleanup, { id })
    return { jobId: id }
} })
async function policy(ctx: MutationCtx, serverId: string) {
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), publishing = await ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 || publishing?.enabled === false) fail(403, "Publishing disabled by current policy")
}
async function boundJob(ctx: MutationCtx, serverId: string, jobId: unknown) {
    const id = ctx.db.normalizeId("dashboardMessageJobs", String(jobId)), job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== serverId) fail(403, "Dashboard message grant mismatch")
    return job
}
async function liveJob(ctx: MutationCtx, serverId: string, jobId: unknown) {
    const job = await boundJob(ctx, serverId, jobId), session = await ctx.db.get(job.sessionId), now = Date.now()
    if (job.expiresAt <= now || !session || session.expiresAt <= now || session.lifetimeAt <= now || !session.servers.some(server => server.id === serverId)) fail(403, "Dashboard permission grant expired")
    await policy(ctx, serverId)
    return job
}
function nativeContext(value: unknown) {
    const input = shape(value, ["jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"], ["jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"])
    if (input.managerAuthorized !== true) fail(403, "Manage Server permission required")
    integer(input.observedAt, Date.now() - 60000, Date.now() + 60000)
    requireId(input.botId)
    return input
}
export async function dashboardMessagePublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const input = nativeContext(value)
    if (attempt.source?.type !== "dashboard-message" || input.jobId !== attempt.source.jobId || input.actorId !== attempt.actorId || input.botId !== attempt.botId || input.channelId !== attempt.channelId) fail(403, "Dashboard publishing grant mismatch")
    const job = await liveJob(ctx, attempt.serverId, input.jobId)
    if (job.state !== "reserved" || job.attemptId !== attempt._id || job.actorId !== attempt.actorId || job.channelId !== attempt.channelId) fail(409, "Dashboard publishing binding changed")
}
export const ready = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const queued = await ctx.db.query("dashboardMessageJobs").withIndex("by_work", q => q.eq("serverId", request.serverId).eq("state", "queued")).take(4)
    const reserved = await ctx.db.query("dashboardMessageJobs").withIndex("by_work", q => q.eq("serverId", request.serverId).eq("state", "reserved")).take(4)
    return { jobs: [...queued, ...reserved].sort((a, b) => a.createdAt - b.createdAt).slice(0, 4).map(publicDashboardMessageJob) }
} })
export const reserve = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const raw = shape(request, ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"], ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"])
    const { serverId: rawServerId, ...context } = raw, serverId = requireId(rawServerId), input = nativeContext(context)
    const job = await liveJob(ctx, serverId, input.jobId)
    if (job.actorId !== input.actorId || job.channelId !== input.channelId) fail(403, "Dashboard publishing grant mismatch")
    if (job.attemptId) {
        const attempt = await ctx.db.get(job.attemptId)
        if (!attempt) fail(503, "Dashboard publication missing")
        return { grant: null, attempt: publicAttempt(attempt) }
    }
    if (job.state !== "queued") fail(409, "Dashboard message job changed")
    const reserved = await reservePublishing(ctx, { serverId, actorId: job.actorId, botId: requireId(input.botId), channelId: job.channelId, sourceId: `dashboard_message_${job._id}`,
        source: { type: "dashboard-message", jobId: job._id, createdAt: job.createdAt }, provenance: { type: "dashboard-message", jobId: job._id }, content: job.content, expiresAt: job.expiresAt })
    await ctx.db.patch(job._id, { state: "reserved", attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)! })
    return { grant: reserved.grant, attempt: null }
} })
async function completeJob(ctx: MutationCtx, job: Doc<"dashboardMessageJobs">) {
    if (job.attemptId && job.state === "reserved") {
        let attempt = await ctx.db.get(job.attemptId)
        if (!attempt || attempt.source?.type !== "dashboard-message" || attempt.source.jobId !== job._id) fail(409, "Dashboard publication changed")
        if (attempt.outcome === "pending") { await age(ctx, attempt, Date.now()); attempt = (await ctx.db.get(attempt._id))! }
        if (attempt.outcome !== "pending") await ctx.db.patch(job._id, { state: attempt.outcome, ...(attempt.messageId ? { messageId: attempt.messageId } : {}),
            ...(attempt.outcome === "sent" ? {} : { error: attempt.outcome === "uncertain" ? "Native message delivery is uncertain and will not be replayed" : "Native message delivery failed" }) })
    }
    return { job: publicDashboardMessageJob((await ctx.db.get(job._id))!) }
}
export const complete = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    return completeJob(ctx, await boundJob(ctx, request.serverId, request.jobId))
} })
export const failJob = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const job = await boundJob(ctx, request.serverId, request.jobId)
    if (job.state === "queued") await ctx.db.patch(job._id, { state: "failed", error: "Fresh native publishing permissions could not be verified" })
    else if (job.state === "reserved") await completeJob(ctx, job)
    return null
} })
export const expire = internalMutation({ args: { id: v.id("dashboardMessageJobs") }, handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id)
    if (!job || job.expiresAt > Date.now()) return
    if (job.state === "queued") await ctx.db.patch(id, { state: "failed", error: "Bot did not send before the permission grant expired" })
    else if (job.state === "reserved") await completeJob(ctx, job)
} })
export const cleanup = internalMutation({ args: { id: v.id("dashboardMessageJobs") }, handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id)
    if (job && job.cleanupAt <= Date.now()) await ctx.db.delete(id)
} })
