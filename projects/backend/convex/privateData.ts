import { v } from "convex/values"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { PrivateAccessReady } from "../contracts.js"
import type { DashboardPrivateAccess, DashboardPrivateData, DashboardPrivateResult, DashboardPrivateView } from "../dashboard-contracts.js"
import { recordAudit } from "./auditLog.ts"
import { privateSession } from "./dashboard.ts"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { privateDataRole } from "./memberAccess.ts"
import { caseByNo, publicAppeal, publicCase } from "./moderationStore.ts"
import { shape } from "./publishingDomain.ts"
import { bool, fail, ids, integer, requireId } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

// Private cases, appeals and member history on the website. Only the server owner and members holding the server's private data role
// may view them, and Administrator alone is not enough. Every view needs a live check that the bot answers with its own fresh Fluxer
// read, never with the viewer's sign-in. A passed check serves views for a short window, and every view that returns data is recorded
// in the audit log with its kind and subject member, never its content

/** How long the bot has to answer an access check */
export const PRIVATE_CHECK_MS = 60000
/** How long a passed check serves views, so paging needs no check per page. A removed role stops access at the next check */
export const PRIVATE_ACCESS_MS = 120000
/** A new check waits this long after the previous one, so a refused viewer cannot keep the bot reading Fluxer */
export const PRIVATE_CHECK_INTERVAL_MS = 10000
export const PRIVATE_PAGE_SIZE = 25
const CHECKS_PER_PASS = 10

const readCheck = (ctx: Pick<QueryCtx, "db">, serverId: string, userId: string) =>
    ctx.db.query("dashboardPrivateAccessJobs").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", userId)).unique()

const sessionArgs = { sessionToken: v.string(), serverId: v.string() }
export const access = query({ args: sessionArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardPrivateAccess> => {
    const session = await privateSession(ctx, sessionToken, serverId), row = await readCheck(ctx, serverId, session.userId)
    return { serverId, roleConfigured: await privateDataRole(ctx, serverId) !== null, check: row ? { state: row.state, requestedAt: row.createdAt,
        ...(row.checkedAt !== undefined ? { checkedAt: row.checkedAt } : {}), ...(row.state === "passed" ? { validUntil: row.checkedAt! + PRIVATE_ACCESS_MS } : {}) } : null }
} })

const before = (value: number | undefined) => value === undefined ? Number.MAX_SAFE_INTEGER : integer(value, 1, Number.MAX_SAFE_INTEGER)
async function readPrivateData(ctx: MutationCtx, serverId: string, view: DashboardPrivateView): Promise<DashboardPrivateData> {
    const cases = async (rows: Array<Parameters<typeof publicCase>[1]>) => ({ cases: await Promise.all(rows.slice(0, PRIVATE_PAGE_SIZE).map(row => publicCase(ctx, row))),
        ...(rows.length > PRIVATE_PAGE_SIZE ? { nextBeforeCaseNo: rows[PRIVATE_PAGE_SIZE - 1]!.caseNo } : {}) })
    switch (view.type) {
        case "cases": return { type: "cases", ...await cases(await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).lt("caseNo", before(view.beforeCaseNo)))
            .order("desc").take(PRIVATE_PAGE_SIZE + 1)) }
        case "case": {
            const row = await caseByNo(ctx, serverId, integer(view.caseNo, 1, Number.MAX_SAFE_INTEGER))
            // Only the case's member may appeal it, at most 20 times
            const appeals = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", serverId).eq("caseNo", row.caseNo)).take(21)
            return { type: "case", case: await publicCase(ctx, row), appeals: appeals.sort((a, b) => b.appealNo - a.appealNo).map(publicAppeal) }
        }
        case "appeals": {
            const rows = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", serverId).lt("appealNo", before(view.beforeAppealNo))).order("desc").take(PRIVATE_PAGE_SIZE + 1)
            return { type: "appeals", appeals: rows.slice(0, PRIVATE_PAGE_SIZE).map(publicAppeal), ...(rows.length > PRIVATE_PAGE_SIZE ? { nextBeforeAppealNo: rows[PRIVATE_PAGE_SIZE - 1]!.appealNo } : {}) }
        }
        case "history": {
            const userId = requireId(view.userId)
            const rows = await ctx.db.query("moderationCases").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("targetId", userId).lt("caseNo", before(view.beforeCaseNo))).order("desc").take(PRIVATE_PAGE_SIZE + 1)
            const appeals = await ctx.db.query("moderationAppeals").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("userId", userId)).order("desc").take(PRIVATE_PAGE_SIZE)
            return { type: "history", userId, ...await cases(rows), appeals: appeals.map(publicAppeal) }
        }
    }
}
// What the audit log keeps of a view: its kind and subject member, never the private content
function viewed(view: DashboardPrivateView, data: DashboardPrivateData) {
    switch (data.type) {
        case "cases": return { setting: "Cases list", summary: view.type === "cases" && view.beforeCaseNo ? `Cases before case ${view.beforeCaseNo}` : "Newest cases" }
        case "case": return { setting: `Case ${data.case.caseNo}`, summary: data.case.targetId ? `Member ${data.case.targetId}` : "No member" }
        case "appeals": return { setting: "Appeals list", summary: view.type === "appeals" && view.beforeAppealNo ? `Appeals before appeal ${view.beforeAppealNo}` : "Newest appeals" }
        case "history": return { setting: "Member history", summary: `Member ${data.userId}` }
    }
}

const viewValidator = v.union(v.object({ type: v.literal("cases"), beforeCaseNo: v.optional(v.number()) }), v.object({ type: v.literal("case"), caseNo: v.number() }),
    v.object({ type: v.literal("appeals"), beforeAppealNo: v.optional(v.number()) }), v.object({ type: v.literal("history"), userId: v.string(), beforeCaseNo: v.optional(v.number()) }))
/** One view. It returns data while the viewer's passed check is fresh, and otherwise asks the bot for a new check */
export const view = mutation({ args: { ...sessionArgs, view: viewValidator }, handler: async (ctx, { sessionToken, serverId, view }): Promise<DashboardPrivateResult> => {
    const session = await privateSession(ctx, sessionToken, serverId), row = await readCheck(ctx, serverId, session.userId), now = Date.now()
    if (row?.state === "passed" && row.checkedAt! + PRIVATE_ACCESS_MS > now) {
        const data = await readPrivateData(ctx, serverId, view)
        await recordAudit(ctx, serverId, { userId: session.userId, name: session.userName, source: "website" }, { kind: "private-data-viewed", feature: "private-data", ...viewed(view, data) })
        return { status: "ok", data }
    }
    // A check is running, or one answered moments ago and its answer stands until the next may start
    if (row?.state === "queued" && row.expiresAt > now) return { status: "checking" }
    if (row && row.state !== "passed" && row.state !== "queued" && row.createdAt > now - PRIVATE_CHECK_INTERVAL_MS) return { status: row.state }
    const next = { serverId, userId: session.userId, state: "queued" as const, createdAt: now, expiresAt: now + PRIVATE_CHECK_MS, cleanupAt: now + PRIVATE_CHECK_MS + PRIVATE_ACCESS_MS }
    if (row) await ctx.db.replace(row._id, next)
    else await ctx.db.insert("dashboardPrivateAccessJobs", next)
    await ctx.scheduler.runAt(next.expiresAt, internal.privateData.expire, { serverId, userId: session.userId })
    await ctx.scheduler.runAt(next.cleanupAt, internal.privateData.cleanup, { serverId, userId: session.userId })
    await ringWork(ctx)
    return { status: "checking" }
} })
const memberArgs = { serverId: v.string(), userId: v.string() }
export const expire = internalMutation({ args: memberArgs, handler: async (ctx, { serverId, userId }) => {
    const row = await readCheck(ctx, serverId, userId)
    if (row?.state === "queued" && row.expiresAt <= Date.now()) await ctx.db.patch(row._id, { state: "failed" })
} })
// A check is useful until its answer's window ends, so its row is deleted then. A newer check moves cleanupAt and schedules its own cleanup
export const cleanup = internalMutation({ args: memberArgs, handler: async (ctx, { serverId, userId }) => {
    const row = await readCheck(ctx, serverId, userId)
    if (row && row.cleanupAt <= Date.now()) await ctx.db.delete(row._id)
} })

// Bot routes. The bot reads each waiting viewer fresh with its own token, and the backend decides with the current private data role
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<PrivateAccessReady> => {
    const serverId = String(shape(request, ["serverId"], ["serverId"]).serverId), now = Date.now()
    const rows = await ctx.db.query("dashboardPrivateAccessJobs").withIndex("by_work", q => q.eq("serverId", serverId).eq("state", "queued")).take(2 * CHECKS_PER_PASS)
    return { checks: rows.filter(row => row.expiresAt > now).slice(0, CHECKS_PER_PASS).map(row => ({ userId: row.userId })) }
} })
/** The bot's answer to a waiting check. A late answer is dropped, since the website already reports that the bot did not answer */
export const record = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "userId", "failed", "isOwner", "present", "roleIds"], ["serverId", "userId"])
    const serverId = String(input.serverId), userId = requireId(input.userId), now = Date.now()
    if (input.failed !== undefined && input.failed !== true) fail(400, "Invalid access check")
    // Facts about the viewer must come from a read of this server
    if (input.failed === undefined && input.originServerId !== serverId) fail(403, "Native evidence server mismatch")
    const answer = input.failed ? undefined : { isOwner: bool(input.isOwner), present: bool(input.present), roleIds: ids(input.roleIds, 1000) }
    const row = await readCheck(ctx, serverId, userId)
    if (row?.state !== "queued" || row.expiresAt <= now) return { recorded: false }
    const role = await privateDataRole(ctx, serverId)
    // The owner always passes. Anyone else needs the private data role, whatever their permissions
    const state = !answer ? "failed" : answer.isOwner || answer.present && role !== null && answer.roleIds.includes(role) ? "passed" : "refused"
    await ctx.db.patch(row._id, { state, checkedAt: now })
    return { recorded: true }
} })
