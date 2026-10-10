import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import { v } from "convex/values"
import { action, query, internalMutation } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardRoleOperation, DashboardRoleJob } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { verifyProvider } from "./dashboardProvider.ts"
import { readRolesSettings } from "./rolesStore.ts"
import { applyRoleManagement, changeRoles } from "./roles.ts"
import { mappings, reservations } from "./rolesDomain.ts"
import { shape, publishingContent } from "./publishingDomain.ts"
import { fail, object, requireId, ids, bool, name, integer } from "./validation.ts"
import { ringWork } from "./workSignal.ts"
import type { MutationCtx } from "./_generated/server.js"
import { publicAttempt, reservePublishing } from "./publishing.ts"

const immutableKey = (value: unknown): string | undefined => JSON.stringify(value, (_, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

export function publicDashboardRoleJob(row: Doc<"dashboardRoleJobs">): DashboardRoleJob {
    return { id: row._id, actorId: row.actorId, section: row.section, expectedRevision: row.expectedRevision, operation: row.operation as DashboardRoleOperation, state: row.state, createdAt: row.createdAt, expiresAt: row.expiresAt, ...(row.error ? { error: row.error } : {}), ...(row.publication ? { publication: row.publication } : {}) }
}
function operation(value: unknown, section: "reaction" | "autorole" | "verification"): DashboardRoleOperation {
    const op = object(value)
    if (op.type === "settings") {
        shape(op, ["type", "patch"], ["type", "patch"])
        const keys = [...(section === "reaction" ? ["panelsEnabled"] : section === "autorole" ? ["autoroleEnabled", "humansOnly", "autoroleIds", "reservations"] : ["verificationEnabled", "advancedVerificationEnabled"])]
        const patch = shape(op.patch, keys)
        if (!Object.keys(patch).length) fail(400, "Choose a setting to change")
        for (const [key, value] of Object.entries(patch)) if (key === "autoroleIds") ids(value, 20); else if (key === "reservations") reservations(value); else bool(value)
        return { type: "settings", patch }
    }
    if (section === "autorole") fail(400, "Autorole has no reaction panel")
    if (op.type === "panel-create") {
        shape(op, ["type", "name", "kind", "mappings", "exclusive"], ["type", "name", "kind", "mappings", "exclusive"])
        if (op.kind !== (section === "reaction" ? "reaction" : "verification")) fail(400, "Wrong panel section")
        return { type: "panel-create", name: name(op.name), kind: section === "reaction" ? "reaction" : "verification", mappings: mappings(op.mappings), exclusive: bool(op.exclusive) }
    }
    if (op.type === "panel-update") {
        shape(op, ["type", "name", "expectedRevision", "patch"], ["type", "name", "expectedRevision", "patch"])
        const patch = shape(op.patch, ["enabled", "exclusive", "mappings"])
        if (!Object.keys(patch).length) fail(400, "Choose a panel setting to change")
        if (patch.mappings !== undefined) mappings(patch.mappings)
        if (patch.enabled !== undefined) bool(patch.enabled)
        if (patch.exclusive !== undefined) bool(patch.exclusive)
        return { type: "panel-update", name: name(op.name), expectedRevision: integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER), patch }
    }
    fail(400, "Unsupported dashboard role operation")
}
const args = { sessionToken: v.string(), serverId: v.string(), section: v.union(v.literal("reaction"), v.literal("autorole"), v.literal("verification")), requestId:v.optional(v.string()), expectedRevision: v.number(), operation: v.any(), publication: v.optional(v.object({ channelId: v.string(), content: v.any() })) }
export const enqueue = internalMutation({ args, handler: async (ctx, input): Promise<{ queued: boolean, conflict: boolean, revision: number, jobId?: string }> => {
    const session = await dashboardSession(ctx, input.sessionToken, input.serverId), op = operation(input.operation, input.section), roles = await readRolesSettings(ctx, input.serverId), revision = roles?.dashboardRevision ?? 0
    integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    if(input.requestId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)) fail(400,"Invalid configuration request")
    if(input.requestId) { const existing=await ctx.db.query("dashboardRoleJobs").withIndex("by_request",q=>q.eq("sessionId",session._id).eq("serverId",input.serverId).eq("requestId",input.requestId)).unique(); if(existing) {if(existing.section!==input.section || existing.expectedRevision!==input.expectedRevision || immutableKey(existing.operation)!==immutableKey(op) || immutableKey(existing.publication)!==immutableKey(input.publication)) fail(409,"Configuration request already used"); return {queued:true,conflict:false,revision,jobId:existing._id}} }
    if (revision !== input.expectedRevision) return { queued: false, conflict: true, revision }
    if (input.publication) {
        requireId(input.publication.channelId)
        if (op.type === "settings") fail(400, "Invalid panel message")
        input.publication.content = publishingContent(input.publication.content, true)
    }
    if (op.type === "panel-update") {
        const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", input.serverId).eq("name", op.name)).unique()
        if (!panel || panel.kind !== (input.section === "reaction" ? "reaction" : "verification")) fail(400, "Wrong panel section")
    }
    const retained = await ctx.db.query("dashboardRoleJobs").withIndex("by_server", q => q.eq("serverId", input.serverId)).take(201)
    if (retained.length >= 200) fail(429, "Dashboard role job capacity reached")
    if (retained.some(row => (row.state === "queued" || row.state === "configured") && row.expiresAt > Date.now())) fail(409, "A role configuration change is still pending")
    const now = Date.now(), expiresAt = Math.min(now + 120000, session.expiresAt)
    const id = await ctx.db.insert("dashboardRoleJobs", {
        serverId: input.serverId, actorId: session.userId, sessionId: session._id, section: input.section, ...(input.requestId ? { requestId: input.requestId } : {}),
        expectedRevision: revision, operation: op, state: "queued", createdAt: now, expiresAt, cleanupAt: now + 86400000, ...(input.publication ? { publication: input.publication } : {}),
    })
    // Expiry runs at the job's own deadline, which a shorter session can bring forward
    await ctx.scheduler.runAt(expiresAt, internal.dashboardRoles.expire, { id })
    await ctx.scheduler.runAt(now + 86400000, internal.dashboardRoles.cleanup, { id })
    await ringWork(ctx)
    return { queued: true, conflict: false, revision, jobId: id }
} })
export const queue = action({ args, handler: async (ctx, input): Promise<{ queued: boolean, conflict: boolean, revision: number, jobId?: string }> => {
    const stored = await ctx.runQuery(internal.dashboard.secret, { sessionToken: input.sessionToken }), identity = await verifyProvider(stored.accessToken)
    if (identity.user.id !== stored.userId || !identity.servers.some(server => server.id === input.serverId)) fail(403, "Manage Server permission required")
    await ctx.runMutation(internal.dashboard.renew, { sessionToken: input.sessionToken, user: identity.user, servers: identity.servers })
    return ctx.runMutation(internal.dashboardRoles.enqueue, input)
} })
export const expire = internalMutation({ args: { id: v.id("dashboardRoleJobs") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && (row.state === "queued" || row.state === "configured") && row.expiresAt <= Date.now()) await ctx.db.patch(id, { state: "failed", error: "Bot did not complete this change before its permission grant expired" })
} })
export const cleanup = internalMutation({ args: { id: v.id("dashboardRoleJobs") }, handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row && row.cleanupAt <= Date.now()) await ctx.db.delete(id)
} })
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const rows = await ctx.db.query("dashboardRoleJobs").withIndex("by_work", q => q.eq("serverId", request.serverId).eq("state", "queued")).take(4)
    const configured = await ctx.db.query("dashboardRoleJobs").withIndex("by_work", q => q.eq("serverId", request.serverId).eq("state", "configured")).take(4)
    return { jobs: [...rows, ...configured].sort((a, b) => a.createdAt - b.createdAt).slice(0, 4).map(publicDashboardRoleJob) }
} })
export const execute = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "roles", "actor"], ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "roles"])
    const id = ctx.db.normalizeId("dashboardRoleJobs", String(input.jobId)), job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== input.serverId || job.actorId !== input.actorId) fail(403, "Dashboard grant mismatch")
    if (job.state !== "queued") return { job: publicDashboardRoleJob(job), result: job.result ?? null }
    const grant = await ctx.db.get(job.sessionId), now = Date.now(), state = await readRolesSettings(ctx, job.serverId)
    if (job.expiresAt <= now || !grant || grant.expiresAt <= now || grant.lifetimeAt <= now || grant.userId!==job.actorId || !grant.servers.some(server => server.id === job.serverId) || input.managerAuthorized !== true) {
        await ctx.db.patch(job._id, { state: "failed", error: "Manage Server permission grant expired or was revoked" })
        return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!), result: null }
    }
    integer(input.observedAt, now - 60000, now + 1000)
    if ((state?.dashboardRevision ?? 0) !== job.expectedRevision) {
        await ctx.db.patch(job._id, { state: "conflict", error: "Role configuration changed after this request was queued" })
        return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!), result: null }
    }
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", job.serverId)).unique()
    if (moderation?.config.defcon === 1) fail(403, "DEFCON restriction")
    const result = await changeRoles(ctx, { serverId: job.serverId, jobId: job._id }, { userId: job.actorId, name: grant.userName, source: "website" }, { ...job.operation as Record<string, unknown>, roles: input.roles }, now)
    await ctx.db.patch(job._id, { state: job.publication ? "configured" : "applied", result })
    await admitMetadata(ctx,job.serverId,metadataEvent({category:"settings",type:"settings-change",source:{kind:"dashboard",scope:"roles",jobId:job._id},observedAt:now,actor:{kind:"configuration",userId:job.actorId},resourceIds:[],changedFields:["configuration"],count:1,outcome:"accepted"},true))
    return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!), result }
} })
export const failJob = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const id = ctx.db.normalizeId("dashboardRoleJobs", String(request.jobId)), job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== request.serverId) fail(403, "Dashboard grant mismatch")
    if (job.state === "queued" || job.state === "configured") await ctx.db.patch(job._id, { state: "failed", error: job.attemptId ? "Panel publication could not be confirmed. Its exact attempt is retained without replay" : "Fresh native role or channel permissions could not be verified" })
    return null
} })

async function publicationJob(ctx: MutationCtx, serverId: string, jobId: unknown) {
    const id = ctx.db.normalizeId("dashboardRoleJobs", String(jobId)), job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== serverId || !job.publication || job.state !== "configured") fail(409, "Dashboard panel job changed")
    const grant = await ctx.db.get(job.sessionId)
    if (job.expiresAt <= Date.now() || !grant || grant.expiresAt <= Date.now() || !grant.servers.some(server => server.id === serverId)) fail(403, "Dashboard permission grant expired")
    // The exact panel revision below fences publication, so unrelated role settings edits do not fail it
    const result = job.result as { type?: string, panel?: { name: string, revision: number } }
    if (result.type !== "panel" || !result.panel) fail(409, "Dashboard panel configuration missing")
    const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", result.panel!.name)).unique()
    if (!panel || panel.revision !== result.panel.revision || panel.withdrawing || !panel.mappings.length) fail(409, "Dashboard panel configuration changed")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), publishing = await ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 || publishing?.enabled === false) fail(403, "Publishing disabled by current policy")
    return { job, panel }
}
export async function dashboardPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const input = shape(value, ["jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"], ["jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"])
    if (attempt.source?.type !== "dashboard-role" || input.jobId !== attempt.source.jobId || input.actorId !== attempt.actorId || input.botId !== attempt.botId || input.channelId !== attempt.channelId || input.managerAuthorized !== true) fail(403, "Dashboard publishing grant mismatch")
    integer(input.observedAt, Date.now() - 60000, Date.now() + 1000)
    const { job, panel } = await publicationJob(ctx, attempt.serverId, input.jobId)
    if (job.attemptId !== attempt._id || job.publication?.channelId !== attempt.channelId || job.actorId !== attempt.actorId || panel.revision !== job.panelRevision) fail(409, "Dashboard publishing binding changed")
}
export const reserve = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"], ["serverId", "jobId", "actorId", "managerAuthorized", "observedAt", "botId", "channelId"])
    const { job, panel } = await publicationJob(ctx, String(input.serverId), input.jobId)
    if (job.actorId !== input.actorId || job.publication?.channelId !== input.channelId || input.managerAuthorized !== true) fail(403, "Dashboard publishing grant mismatch")
    integer(input.observedAt, Date.now() - 60000, Date.now() + 1000)
    if (job.attemptId) {
        const attempt = await ctx.db.get(job.attemptId)
        if (!attempt) fail(503, "Dashboard publication missing")
        // A previously reserved publication is never replayed by this worker
        return { grant: null, attempt: publicAttempt(attempt) }
    }
    const reserved = await reservePublishing(ctx, { serverId: job.serverId, actorId: job.actorId, botId: requireId(input.botId), channelId: job.publication!.channelId, sourceId: `dashboard_${job._id}`,
        source: { type: "dashboard-role", jobId: job._id, createdAt: job.createdAt }, provenance: { type: "dashboard-role", jobId: job._id, panelName: panel.name, panelRevision: panel.revision }, content: job.publication!.content })
    await ctx.db.patch(job._id, { attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!, postNo: reserved.grant.postNo, panelRevision: panel.revision })
    return { grant: reserved.grant, attempt: null }
} })
export const complete = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const id = ctx.db.normalizeId("dashboardRoleJobs", String(request.jobId)), job = id ? await ctx.db.get(id) : null
    if (!job || job.serverId !== request.serverId || !job.attemptId) fail(409, "Dashboard panel job changed")
    const attempt = await ctx.db.get(job.attemptId)
    if (!attempt || attempt.source?.type !== "dashboard-role" || attempt.source.jobId !== job._id) fail(409, "Dashboard publication changed")
    if (attempt.outcome === "pending") return { job: publicDashboardRoleJob(job) }
    if (job.state === "applied") return { job: publicDashboardRoleJob(job), result: job.result }
    if (attempt.outcome !== "sent") {
        await ctx.db.patch(job._id, { state: "failed", error: attempt.outcome === "uncertain" ? "Native panel delivery is uncertain and will not be replayed" : "Native panel delivery failed" })
        return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!) }
    }
    // A delivered panel always binds when its panel revision is unchanged, unrelated settings edits do not strand it
    const result = job.result as { panel: { name: string, revision: number } }
    const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", job.serverId).eq("name", result.panel.name)).unique()
    if (!panel || panel.revision !== result.panel.revision || panel.withdrawing) {
        await ctx.db.patch(job._id, { state: "conflict", error: "Panel was delivered, but its configuration changed before binding" })
        return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!) }
    }
    const bound = await applyRoleManagement(ctx, { serverId: job.serverId, jobId: job._id, phase:"bind" }, { type: "panel-bind", name: result.panel.name, expectedRevision: result.panel.revision, postNo: job.postNo, expectedPostGeneration: attempt.generation }, Date.now())
    await ctx.db.patch(job._id, { state: "applied", result: bound })
    return { job: publicDashboardRoleJob((await ctx.db.get(job._id))!), result: bound }
} })

