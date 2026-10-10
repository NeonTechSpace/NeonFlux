import { v } from "convex/values"
import { action, query, internalMutation } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardMetadataJob, DashboardMetadataSnapshot, DashboardMetadataQueueResult } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { verifyProvider } from "./dashboardProvider.ts"
import { applyMetadataConfiguration, metadataConfigurationCritical, metadataConfigurationOperation } from "./metadataLogsStore.ts"
import { admitMetadata, publicMetadataSettings, readMetadataSettings } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

export function publicDashboardMetadataJob(row: Doc<"dashboardMetadataJobs">): DashboardMetadataJob {
    return { id: row._id, actorId: row.actorId, expectedConfigRevision: row.expectedConfigRevision, operation: row.operation as DashboardMetadataJob["operation"], state: row.state, createdAt: row.createdAt, expiresAt: row.expiresAt, ...(row.error ? { error: row.error } : {}) }
}
const args = { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), expectedConfigRevision: v.number(), operation: v.any() }
const operationKey = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

export const snapshot = query({ args: { sessionToken: v.string(), serverId: v.string() }, handler: async (ctx, input): Promise<DashboardMetadataSnapshot> => {
    await dashboardSession(ctx, input.sessionToken, input.serverId)
    return { serverId: input.serverId, settings: publicMetadataSettings(await readMetadataSettings(ctx, input.serverId)), jobs: (await ctx.db.query("dashboardMetadataJobs").withIndex("by_server", q => q.eq("serverId", input.serverId)).order("desc").take(10)).map(publicDashboardMetadataJob) }
} })

export const queue = action({ args, handler: async (ctx, input): Promise<DashboardMetadataQueueResult> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: input.sessionToken }), identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === input.serverId)) {
        await ctx.runMutation(internal.dashboard.revoke, { sessionToken: input.sessionToken })
        fail(403, "Manage Server permission required")
    }
    await ctx.runMutation(internal.dashboard.renew, { sessionToken: input.sessionToken, user: identity.user, servers: identity.servers })
    return ctx.runMutation(internal.dashboardMetadata.enqueue, input)
} })

export const enqueue = internalMutation({ args, handler: async (ctx, input): Promise<DashboardMetadataQueueResult> => {
    const session = await dashboardSession(ctx, input.sessionToken, input.serverId), operation = metadataConfigurationOperation(input.operation)
    integer(input.expectedConfigRevision, 0, Number.MAX_SAFE_INTEGER)
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)) fail(400, "Invalid configuration request")
    const existing = await ctx.db.query("dashboardMetadataJobs").withIndex("by_request", q => q.eq("sessionId", session._id).eq("serverId", input.serverId).eq("requestId", input.requestId)).unique()
    const settings = publicMetadataSettings(await readMetadataSettings(ctx, input.serverId)), revision = settings.configRevision
    if (existing) {
        if (existing.expectedConfigRevision !== input.expectedConfigRevision || operationKey(existing.operation) !== operationKey(operation)) fail(409, "Configuration request already used")
        return { queued: true, conflict: false, revision, jobId: existing._id }
    }
    if (revision !== input.expectedConfigRevision) return { queued: false, conflict: true, revision }
    const retained = await ctx.db.query("dashboardMetadataJobs").withIndex("by_server", q => q.eq("serverId", input.serverId)).take(201)
    if (retained.length >= 200) fail(429, "Dashboard configuration capacity reached")
    if (retained.some(row => row.state === "queued" && row.expiresAt > Date.now())) fail(409, "A logging configuration change is still pending")
    const createdAt = Date.now(), expiresAt = Math.min(createdAt + 120000, session.expiresAt)
    const id = await ctx.db.insert("dashboardMetadataJobs", { serverId: input.serverId, actorId: session.userId, sessionId: session._id, requestId: input.requestId, expectedConfigRevision: revision, operation, state: "queued", createdAt, expiresAt, cleanupAt: createdAt + 86400000 })
    await ctx.scheduler.runAt(expiresAt, internal.dashboardMetadata.expire, { id })
    await ctx.scheduler.runAt(createdAt + 86400000, internal.dashboardMetadata.cleanup, { id })
    await ringWork(ctx)
    return { queued: true, conflict: false, revision, jobId: id }
} })

export const expire = internalMutation({ args: { id: v.id("dashboardMetadataJobs") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && row.state === "queued" && row.expiresAt <= Date.now()) await ctx.db.patch(id, { state: "failed", error: "Bot did not complete this change before its permission grant expired" })
} })
export const cleanup = internalMutation({ args: { id: v.id("dashboardMetadataJobs") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && row.cleanupAt <= Date.now()) await ctx.db.delete(id)
} })
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId"], ["serverId"])
    return { jobs: (await ctx.db.query("dashboardMetadataJobs").withIndex("by_work", q => q.eq("serverId", String(input.serverId)).eq("state", "queued")).take(4)).filter(row => row.expiresAt > Date.now()).map(publicDashboardMetadataJob) }
} })

export const execute = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "recipientOwner"], ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt"])
    const id = typeof input.jobId === "string" ? ctx.db.normalizeId("dashboardMetadataJobs", input.jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== input.serverId || job.actorId !== input.actorId) fail(403, "Dashboard configuration grant mismatch")
    if (job.state !== "queued") return { job: publicDashboardMetadataJob(job), settings: null }
    const session = await ctx.db.get(job.sessionId), now = Date.now()
    if (job.expiresAt <= now || !session || session.expiresAt <= now || session.lifetimeAt <= now || session.userId !== job.actorId || !session.servers.some(server => server.id === job.serverId) || input.managerAuthorized !== true) {
        await ctx.db.patch(job._id, { state: "failed", error: "Manage Server permission grant expired or was revoked" })
        return { job: publicDashboardMetadataJob((await ctx.db.get(job._id))!), settings: null }
    }
    integer(input.observedAt, Math.max(0, now - 60000), now + 60000)
    const operation = metadataConfigurationOperation(job.operation), settings = publicMetadataSettings(await readMetadataSettings(ctx, job.serverId))
    if (settings.configRevision !== job.expectedConfigRevision) {
        await ctx.db.patch(job._id, { state: "conflict", error: "Logging configuration changed after this request was queued" })
        return { job: publicDashboardMetadataJob((await ctx.db.get(job._id))!), settings: null }
    }
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", job.serverId)).unique()
    if (moderation?.config.defcon === 1 && !metadataConfigurationCritical(operation)) fail(403, "DEFCON restriction")
    if (input.recipientOwner !== undefined && operation.type !== "route" && operation.type !== "event-route") fail(400, "Unexpected metadata recipient")
    const result = await applyMetadataConfiguration(ctx, job.serverId, operation, input.recipientOwner)
    await ctx.db.patch(job._id, { state: "applied" })
    await admitMetadata(ctx, job.serverId, metadataEvent({ category: "settings", type: "settings-change", source: { kind: "dashboard", jobId: job._id, scope: "metadata" }, observedAt: now, actor: { kind: "configuration", userId: job.actorId }, resourceIds: [], changedFields: result.changedFields, count: 1, outcome: "accepted" }, true), result.previouslyEnabled)
    return { job: publicDashboardMetadataJob((await ctx.db.get(job._id))!), settings: result.settings }
} })
export const failJob = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "jobId"], ["serverId", "jobId"])
    const id = typeof input.jobId === "string" ? ctx.db.normalizeId("dashboardMetadataJobs", input.jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== input.serverId) fail(403, "Dashboard configuration grant mismatch")
    if (job.state === "queued") await ctx.db.patch(job._id, { state: "failed", error: "Fresh manager or logging destination permissions could not be verified" })
    return null
} })
