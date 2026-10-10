import { v } from "convex/values"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardStructure, DashboardStructurePreview, StructureChannel, StructureClaim, StructureEntry, StructureReadyJob, StructureResult } from "../dashboard-contracts.js"
import { recordAudit } from "./auditLog.ts"
import { dashboardSession } from "./dashboard.ts"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer, requireId } from "./validation.ts"
import { ringWork } from "./workSignal.ts"
import { STRUCTURE_CHANGES, structureArchived, structureAudit, structureChannels, structureChanges, structureDraft, structureMerge, structureRead, threadParents } from "./structureDomain.ts"
import { structureEntry } from "./structureValidators.ts"

// The website's server structure editor. Every read and save runs through the bot with its own token, for the signed-in manager:
// the bot lists only what that manager can see, and a save checks Manage Channels in each channel the manager changes. A save is
// claimed before the bot writes anything, so a lost answer never makes the bot write it twice

/** How long the bot has to answer a request */
export const STRUCTURE_MS = 60000
/** A new read waits this long after the previous one, so the refresh button cannot keep the bot reading Fluxer */
export const STRUCTURE_INTERVAL_MS = 10000
/** How long a claimed save may write, and how long after that an unconfirmed save counts as uncertain */
export const STRUCTURE_APPLY_MS = 90000
export const STRUCTURE_SETTLE_MS = 30000
/** A manager's editor row is deleted a day after their last request */
export const STRUCTURE_KEEP_MS = 86400000
const JOBS_PER_PASS = 10, ARCHIVED_CHANNELS = 10

type Row = Doc<"dashboardStructureJobs">
const rowOf = (ctx: Pick<QueryCtx, "db">, serverId: string, userId: string) =>
    ctx.db.query("dashboardStructureJobs").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", userId)).unique()
const busy = (row: Row, now: number) => (row.state === "queued" || row.state === "applying") && row.expiresAt > now
// A claimed save shows its results once the bot confirms them or the save turns uncertain
const publicStructure = (row: Row): DashboardStructure => ({ serverId: row.serverId, state: row.state, work: row.work.type, requestedAt: row.createdAt, ...(row.failure ? { failure: row.failure } : {}),
    read: row.read as DashboardStructure["read"] ?? null, ...(row.changedAt !== undefined ? { changedAt: row.changedAt } : {}), archived: row.archived,
    save: row.save && row.state !== "applying" ? { requestedAt: row.save.requestedAt, results: row.save.results as StructureResult[] } : null })

async function queue(ctx: MutationCtx, row: Row | null, owner: { serverId: string, userId: string, userName: string }, work: Row["work"], now: number) {
    const fields = { state: "queued" as const, work, createdAt: now, expiresAt: now + STRUCTURE_MS, cleanupAt: now + STRUCTURE_KEEP_MS, userName: owner.userName }
    if (row) await ctx.db.patch(row._id, { ...fields, failure: undefined, ...(work.type === "save" ? { save: undefined } : {}) })
    else await ctx.db.insert("dashboardStructureJobs", { ...owner, ...fields, archived: [] })
    await ctx.scheduler.runAt(fields.expiresAt, internal.structure.expire, { serverId: owner.serverId, userId: owner.userId })
    await ctx.scheduler.runAt(fields.cleanupAt, internal.structure.cleanup, { serverId: owner.serverId, userId: owner.userId })
}
// Changes that were applied, or may have been, stay in the audit log under the manager who saved them
async function audit(ctx: MutationCtx, row: Row, results: readonly StructureResult[]) {
    for (const result of results) if (result.outcome === "applied" || result.outcome === "uncertain") {
        await recordAudit(ctx, row.serverId, { userId: row.userId, name: row.userName, source: "website" }, { kind: "setting", feature: "structure", ...structureAudit(result.change, result.outcome) })
    }
}

const sessionArgs = { sessionToken: v.string(), serverId: v.string() }
export const view = query({ args: sessionArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardStructure | null> => {
    const session = await dashboardSession(ctx, sessionToken, serverId), row = await rowOf(ctx, serverId, session.userId)
    return row ? publicStructure(row) : null
} })
/** Ask the bot to read the server again for this manager */
export const request = mutation({ args: sessionArgs, handler: async (ctx, { sessionToken, serverId }) => {
    const session = await dashboardSession(ctx, sessionToken, serverId), row = await rowOf(ctx, serverId, session.userId), now = Date.now()
    if (row && (busy(row, now) || row.work.type === "read" && row.createdAt > now - STRUCTURE_INTERVAL_MS)) return null
    await queue(ctx, row, { serverId, userId: session.userId, userName: session.userName }, { type: "read" }, now)
    await ringWork(ctx)
    return null
} })
/** Ask the bot for the closed threads of one channel from the latest read */
export const threads = mutation({ args: { ...sessionArgs, channelId: v.string() }, handler: async (ctx, { sessionToken, serverId, channelId }) => {
    const session = await dashboardSession(ctx, sessionToken, serverId), row = await rowOf(ctx, serverId, session.userId), now = Date.now()
    const channel = row?.read?.channels.find(entry => entry.id === channelId)
    if (!row || !channel || !threadParents.has(channel.type)) fail(400, "Unknown channel")
    if (busy(row, now)) return null
    await queue(ctx, row, { serverId, userId: session.userId, userName: session.userName }, { type: "threads", channelId }, now)
    await ringWork(ctx)
    return null
} })
const layoutArgs = { ...sessionArgs, base: v.array(structureEntry), draft: v.array(structureEntry) }
/** What saving the draft would do against the latest read, decided as a save decides */
export const preview = query({ args: layoutArgs, handler: async (ctx, { sessionToken, serverId, base, draft }): Promise<DashboardStructurePreview | null> => {
    const session = await dashboardSession(ctx, sessionToken, serverId), layouts = structureDraft(base, draft), row = await rowOf(ctx, serverId, session.userId)
    if (!row?.read) return null
    return { readAt: row.read.readAt, items: structureMerge(layouts.base, layouts.draft, row.read.channels as StructureChannel[]).map(({ apply: _apply, ...item }) => item) }
} })
/** Queue the draft for the bot, which reads the server again and merges the draft with it before it writes anything. requestedAt names the save in its results */
export const save = mutation({ args: layoutArgs, handler: async (ctx, { sessionToken, serverId, base, draft }) => {
    const session = await dashboardSession(ctx, sessionToken, serverId), layouts = structureDraft(base, draft), row = await rowOf(ctx, serverId, session.userId), now = Date.now()
    const count = structureChanges(layouts.base, layouts.draft).length
    if (!count) fail(400, "The draft changes nothing")
    if (count > STRUCTURE_CHANGES) fail(413, `Save at most ${STRUCTURE_CHANGES} changes at once`)
    if (!row?.read) fail(409, "Load the structure first")
    if (busy(row, now)) return { queued: false }
    await queue(ctx, row, { serverId, userId: session.userId, userName: session.userName }, { type: "save", ...layouts }, now)
    await ringWork(ctx)
    return { queued: true, requestedAt: now }
} })

const memberArgs = { serverId: v.string(), userId: v.string() }
/** A request the bot did not answer fails, and a save it claimed but never confirmed becomes uncertain */
export const expire = internalMutation({ args: memberArgs, handler: async (ctx, { serverId, userId }) => {
    const row = await rowOf(ctx, serverId, userId), now = Date.now()
    if (!row || row.expiresAt > now) return
    if (row.state === "queued") await ctx.db.patch(row._id, { state: "failed", failure: "unanswered" })
    if (row.state === "applying") {
        await ctx.db.patch(row._id, { state: "failed", failure: "uncertain" })
        await audit(ctx, row, (row.save?.results ?? []).filter(result => row.save!.pending.includes(result.itemNo)) as StructureResult[])
    }
} })
// Every request moves cleanupAt a day ahead and schedules its own cleanup
export const cleanup = internalMutation({ args: memberArgs, handler: async (ctx, { serverId, userId }) => {
    const row = await rowOf(ctx, serverId, userId)
    if (row && row.cleanupAt <= Date.now()) await ctx.db.delete(row._id)
} })

// Bot routes. The bot answers each waiting request with its own reads for the manager who asked
async function waiting(ctx: MutationCtx, request: Record<string, unknown>, type: Row["work"]["type"]) {
    const row = await rowOf(ctx, String(request.serverId), requireId(request.userId))
    return row?.state === "queued" && row.createdAt === integer(request.requestedAt, 0, Number.MAX_SAFE_INTEGER) && row.work.type === type && row.expiresAt > Date.now() ? row : null
}
// Facts about what the manager can see must come from a read of this server
function origin(request: Record<string, unknown>) {
    if (request.originServerId !== request.serverId) fail(403, "Native evidence server mismatch")
}
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<{ jobs: StructureReadyJob[] }> => {
    const serverId = String(shape(request, ["serverId"], ["serverId"]).serverId), now = Date.now()
    const rows = await ctx.db.query("dashboardStructureJobs").withIndex("by_work", q => q.eq("serverId", serverId).eq("state", "queued")).take(2 * JOBS_PER_PASS)
    return { jobs: rows.filter(row => row.expiresAt > now).slice(0, JOBS_PER_PASS).map(row => ({ userId: row.userId, requestedAt: row.createdAt,
        work: row.work.type === "save" ? { type: "save" } : row.work })) }
} })
/** A read or a closed thread page, or why the bot could not answer. A late answer is dropped */
export const answer = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const r = shape(request, ["serverId", "userId", "requestedAt", "work", "read", "threads", "failure"], ["serverId", "userId", "requestedAt", "work"]), now = Date.now()
    if (r.failure !== undefined) {
        if (r.failure !== "access" && r.failure !== "error" || r.read !== undefined || r.threads !== undefined || !["read", "threads", "save"].includes(String(r.work))) fail(400, "Invalid structure answer")
        const row = await waiting(ctx, r, r.work as Row["work"]["type"])
        if (!row) return { recorded: false }
        await ctx.db.patch(row._id, { state: "failed", failure: r.failure })
        return { recorded: true }
    }
    origin(r)
    if (r.work === "read" && r.threads === undefined) {
        const read = structureRead(r.read, now), row = await waiting(ctx, r, "read")
        if (!row) return { recorded: false }
        // A fresh read starts over: closed threads load again on request, and the change notice waits for the next change
        await ctx.db.patch(row._id, { state: "done", read, changedAt: undefined, archived: [] })
        return { recorded: true }
    }
    if (r.work !== "threads" || r.read !== undefined) fail(400, "Invalid structure answer")
    const page = structureArchived(r.threads), row = await waiting(ctx, r, "threads")
    if (!row || row.work.type !== "threads" || row.work.channelId !== page.channelId) return { recorded: false }
    await ctx.db.patch(row._id, { state: "done", archived: [page, ...row.archived.filter(entry => entry.channelId !== page.channelId)].slice(0, ARCHIVED_CHANNELS) })
    return { recorded: true }
} })
/** The bot takes a waiting save with the structure it just read. The merge decides each change, and the bot writes only those that apply */
export const claim = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<StructureClaim> => {
    const r = shape(request, ["serverId", "userId", "requestedAt", "current"], ["serverId", "userId", "requestedAt", "current"]), now = Date.now()
    origin(r)
    const current = structureChannels(r.current), row = await waiting(ctx, r, "save")
    if (!row || row.work.type !== "save") return { claimed: false, applyUntil: 0, apply: [] }
    const items = structureMerge(row.work.base as StructureEntry[], row.work.draft as StructureEntry[], current)
    const apply = items.flatMap(item => item.apply ? [item.apply] : [])
    // Until the bot confirms them, changes it may write count as uncertain
    const results = items.map(({ itemNo, change, disposition, reason, apply: write }): StructureResult => ({ itemNo, change, reason: write ? null : reason,
        outcome: write ? "uncertain" : disposition === "skip" ? "skipped" : disposition as StructureResult["outcome"] }))
    const applyUntil = now + STRUCTURE_APPLY_MS, expiresAt = applyUntil + STRUCTURE_SETTLE_MS
    await ctx.db.patch(row._id, { state: "applying", expiresAt, save: { requestedAt: row.createdAt, results, pending: apply.map(write => write.itemNo) } })
    await ctx.scheduler.runAt(expiresAt, internal.structure.expire, { serverId: row.serverId, userId: row.userId })
    return { claimed: true, applyUntil, apply }
} })
const outcomes = new Set(["applied", "failed", "uncertain"])
/** The outcome of every change the bot was asked to write. The editor then reads the server again for the manager */
export const record = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const r = shape(request, ["serverId", "userId", "requestedAt", "results"], ["serverId", "userId", "requestedAt", "results"]), now = Date.now()
    const row = await rowOf(ctx, String(r.serverId), requireId(r.userId)), save = row?.save
    if (!Array.isArray(r.results) || r.results.length > STRUCTURE_CHANGES) fail(400, "Invalid structure results")
    const reported = new Map(r.results.map(item => {
        const value = shape(item, ["itemNo", "outcome", "reason"], ["itemNo", "outcome"])
        if (!outcomes.has(String(value.outcome)) || value.reason !== undefined && (typeof value.reason !== "string" || !value.reason || value.reason.length > 300)) fail(400, "Invalid structure results")
        return [integer(value.itemNo, 1, STRUCTURE_CHANGES), { outcome: value.outcome as StructureResult["outcome"], reason: (value.reason as string | undefined) ?? null }]
    }))
    if (!row || !save || row.state !== "applying" || save.requestedAt !== integer(r.requestedAt, 0, Number.MAX_SAFE_INTEGER) || row.expiresAt <= now) return { recorded: false }
    if (reported.size !== r.results.length || reported.size !== save.pending.length || save.pending.some(itemNo => !reported.has(itemNo))) fail(400, "Invalid structure results")
    const results = (save.results as StructureResult[]).map(result => ({ ...result, ...reported.get(result.itemNo) }))
    await ctx.db.patch(row._id, { save: { ...save, results, pending: [] } })
    await audit(ctx, row, results.filter(result => save.pending.includes(result.itemNo)))
    // The bot's own write queues the read, so its answer tells the bot to dispatch again without the shared work signal
    await queue(ctx, row, row, { type: "read" }, now)
    return { recorded: true }
} })
/** A channel was created, changed, deleted or reordered. Every editor with a read of this server shows that the read is out of date */
export const changed = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const serverId = String(shape(request, ["serverId"], ["serverId"]).serverId), now = Date.now()
    let marked = 0
    for (const row of await ctx.db.query("dashboardStructureJobs").withIndex("by_member", q => q.eq("serverId", serverId)).take(50)) {
        if (row.read && row.changedAt === undefined) { await ctx.db.patch(row._id, { changedAt: now }); marked++ }
    }
    return { marked }
} })
