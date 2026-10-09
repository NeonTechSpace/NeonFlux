import { v } from "convex/values"
import { RolesReactionJobsRequest, type RolesReactionJob, type RolesReactionJobBinding, type RolesReactionJobsResult } from "@neonflux/contracts/roles"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { consumerKey, ROLES_DAY } from "./rolesDomain.ts"
import { readRolesSettings, type RolesRead } from "./rolesStore.ts"
import { decode, fail, requireReadMember, requireServer, integer } from "./validation.ts"

const LEASE_MS = 600000
export function publicReactionJob(row: Doc<"roleReactionJobs">): RolesReactionJob {
    return { jobId: row._id, name: row.name, revision: row.revision, messageId: row.messageId, channelId: row.channelId, generation: row.generation, pageStep: row.pageStep, status: row.status, rerun: row.rerun, ...(row.leaseExpiresAt !== undefined ? { leaseExpiresAt: row.leaseExpiresAt } : {}) }
}
async function job(ctx: RolesRead, serverId: string, value: unknown) {
    const id = typeof value === "string" ? ctx.db.normalizeId("roleReactionJobs", value) : null, row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Reaction job not found")
    return row
}
async function current(ctx: RolesRead, row: Pick<Doc<"roleReactionJobs">, "serverId" | "name" | "revision" | "messageId" | "channelId">) {
    const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", row.serverId).eq("name", row.name)).unique()
    const settings = await readRolesSettings(ctx, row.serverId)
    return !!panel?.enabled && !panel.withdrawing && panel.revision === row.revision && panel.published?.revision === row.revision && panel.published.messageId === row.messageId && panel.published.channelId === row.channelId && (panel.kind === "reaction" ? settings?.config.panelsEnabled : settings?.config.verificationEnabled)
}
// Requests decode their binding, and an attempt keeps the binding its reservation was fenced with
export async function reactionFence(ctx: RolesRead, serverId: string, input: RolesReactionJobBinding) {
    const row = await job(ctx, serverId, input.jobId), capability = input.claimToken, index = input.index
    if (row.status !== "running" || !row.active || row.generation !== input.generation || row.pageStep !== input.pageStep || row.leaseToken !== capability || row.leaseExpiresAt === undefined || Date.now() >= row.leaseExpiresAt || !row.targets[index] || !await current(ctx, row)) fail(409, "Reaction page lease changed")
    return { row, index, binding: { jobId: row._id, generation: row.generation, claimToken: capability, pageStep: row.pageStep, index } satisfies RolesReactionJobBinding }
}
export async function completeReactionTarget(ctx: MutationCtx, row: Doc<"roleReactionJobs">, index: number, blocked: boolean) {
    const fresh = (await ctx.db.get(row._id))!
    await ctx.db.patch(row._id, { pageDone: fresh.pageDone.includes(index) ? fresh.pageDone : [...fresh.pageDone, index], blockedWork: fresh.blockedWork || blocked, updatedAt: Date.now() })
}
async function cancel(ctx: MutationCtx, row: Doc<"roleReactionJobs">, now: number) {
    await ctx.db.patch(row._id, { status: "cancelled", active: false, leaseToken: undefined, leaseExpiresAt: undefined, expiresAt: now + ROLES_DAY, updatedAt: now })
    return (await ctx.db.get(row._id))!
}
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesReactionJobsResult> => {
    const { serverId, operation: op } = decode(RolesReactionJobsRequest, request), now = Date.now(); requireServer(serverId)
    if (op.type === "list") {
        const rows = await ctx.db.query("roleReactionJobs").withIndex("by_server_active", q => q.eq("serverId", serverId).eq("active", true)).take(52), jobs: RolesReactionJob[] = []
        for (const row of rows) { if (!await current(ctx, row)) await cancel(ctx, row, now); else jobs.push(publicReactionJob(row)) }
        return { type: "jobs", jobs }
    }
    if (op.type === "enqueue") {
        const messageId = op.messageId, panel = await ctx.db.query("rolePanels").withIndex("by_server_message", q => q.eq("serverId", serverId).eq("published.messageId", messageId)).unique()
        if (!panel?.published || panel.revision !== panel.published.revision) fail(404, "Current reaction panel not found")
        const old = await ctx.db.query("roleReactionJobs").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", panel.name)).unique()
        const base = { serverId, name: panel.name, revision: panel.published.revision, messageId, channelId: panel.published.channelId, generation: (old?.generation ?? 0) + 1, pageStep: 0, status: "queued" as const, active: true, rerun: false, blockedWork: false, targets: [], pageDone: [], createdAt: now, updatedAt: now }
        if (!await current(ctx, base)) fail(403, "Reaction panel unavailable")
        if (old?.active && old.revision === base.revision && old.messageId === messageId) {
            await ctx.db.patch(old._id, { rerun: true, updatedAt: now })
            return { type: "job", job: publicReactionJob((await ctx.db.get(old._id))!) }
        }
        const active = await ctx.db.query("roleReactionJobs").withIndex("by_server_active", q => q.eq("serverId", serverId).eq("active", true)).take(52)
        if ((!old?.active && active.length >= 51) || !old && (await ctx.db.query("roleReactionJobs").withIndex("by_server", q => q.eq("serverId", serverId)).take(1001)).length >= 1000) fail(429, "Reaction job capacity reached")
        const id = old?._id ?? await ctx.db.insert("roleReactionJobs", base)
        if (old) await ctx.db.replace(old._id, base)
        return { type: "job", job: publicReactionJob((await ctx.db.get(id))!) }
    }
    if (op.type === "skip") {
        const { row, index } = await reactionFence(ctx, serverId, op.binding), target = row.targets[index]!
        requireReadMember(op, target.userId)
        if (op.observedAt !== undefined) integer(op.observedAt, now - 60000, now + 1000)
        if (op.currentJoinedAt === target.joinedAt) fail(409, "Reaction target membership unchanged")
        const owners = await ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", serverId).eq("userId", target.userId).eq("joinedAt", target.joinedAt)).take(1001)
        await completeReactionTarget(ctx, row, index, owners.some(x => x.status !== "idle"))
        return { type: "job", job: publicReactionJob((await ctx.db.get(row._id))!) }
    }
    if (op.type === "block") {
        const { row, index } = await reactionFence(ctx, serverId, op.binding)
        await completeReactionTarget(ctx, row, index, true)
        return { type: "job", job: publicReactionJob((await ctx.db.get(row._id))!) }
    }
    const row = await job(ctx, serverId, op.jobId)
    if (!await current(ctx, row)) return { type: "job", job: publicReactionJob(await cancel(ctx, row, now)) }
    if (op.type === "claim") {
        const capability = op.claimToken
        if (!row.active || row.status === "running" && row.leaseExpiresAt !== undefined && now < row.leaseExpiresAt) return { type: "page", claimed: false, job: publicReactionJob(row) }
        const cursor = row.status === "blocked" ? undefined : row.cursor
        const page = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", serverId).eq("consumerKey", consumerKey(row.name, row.revision)).eq("configuration", false)).paginate({ numItems: 10, cursor: cursor ?? null })
        const targets: { userId: string, joinedAt: string }[] = []
        for (const ref of page.page) {
            const owner = ref.ownershipId ? await ctx.db.get(ref.ownershipId) : null
            if (owner && !targets.some(x => x.userId === owner.userId && x.joinedAt === owner.joinedAt)) targets.push({ userId: owner.userId, joinedAt: owner.joinedAt })
        }
        await ctx.db.patch(row._id, { generation: row.generation + 1, pageStep: row.pageStep + 1, status: "running", leaseToken: capability, leaseExpiresAt: now + LEASE_MS, targets, pageDone: [], pageEnd: page.continueCursor, pageHasMore: !page.isDone, cursor, ...(row.status === "blocked" ? { blockedWork: false, rerun: false } : {}), updatedAt: now })
        const fresh = (await ctx.db.get(row._id))!
        return { type: "page", claimed: true, job: publicReactionJob(fresh), targets: targets.map((x, index) => ({ ...x, sourceId: `job_${fresh._id}_${fresh.generation}_${fresh.pageStep}_${index}` })), hasMore: !page.isDone }
    }
    if (op.type === "checkpoint") {
        if (row.status !== "running" || row.generation !== op.generation || row.pageStep !== op.pageStep || row.leaseToken !== op.claimToken || row.leaseExpiresAt === undefined || now >= row.leaseExpiresAt) fail(409, "Reaction checkpoint lease changed")
        if (row.pageDone.length !== row.targets.length) fail(409, "Reaction page remains unobserved")
        const blocked = row.blockedWork || op.blocked, more = row.pageHasMore || row.rerun
        await ctx.db.patch(row._id, { status: more ? "queued" : blocked ? "blocked" : "complete", active: !!more || blocked, cursor: row.pageHasMore ? row.pageEnd : undefined, ...(row.pageHasMore ? {} : { rerun: false }), blockedWork: blocked, leaseToken: undefined, leaseExpiresAt: undefined, targets: [], pageDone: [], pageEnd: undefined, pageHasMore: undefined, ...(!more && !blocked ? { expiresAt: now + ROLES_DAY } : {}), updatedAt: now })
        return { type: "job", job: publicReactionJob((await ctx.db.get(row._id))!) }
    }
    fail(400, "Invalid reaction job operation")
} })
