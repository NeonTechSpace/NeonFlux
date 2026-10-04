import { v } from "convex/values"
import type { AppealMemberResult, AppealStaffResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import { actor, administrator, authorize, RETENTION } from "./moderationDomain.ts"
import { caseByNo, config, paged, publicAppeal, receipt, state } from "./moderationStore.ts"
import { fail, object, requireId, integer, source, text } from "./validation.ts"

const eligible = (row: { action: string, outcome: string, erased: boolean, voided: boolean }) => !row.erased && !row.voided && row.outcome !== "failed" && ["warn", "kick", "ban", "timeout", "quarantine"].includes(row.action)
export const member = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AppealMemberResult> => {
    const input = object(request); const now = Date.now(); const identity = source(input, now); const userId = requireId(input.requesterId); const op = object(input.operation)
    if (input.privateChannelVerified !== true) fail(403, "Private channel required")
    const current = await state(ctx, identity.serverId); const settings = config(current)
    if (!settings.appealsEnabled || settings.defcon === 1) fail(403, "Appeals unavailable")
    const claim = await receipt(ctx, identity.serverId, `appeal:${identity.messageId}`, now)
    if (claim.duplicate) return { duplicate: true }
    if (op.type === "cases") {
        const before = op.beforeCaseNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeCaseNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("moderationCases").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("targetId", userId).lt("caseNo", before)).order("desc").take(11)
        const selected = rows.slice(0, 10)
        const cases = selected.filter(eligible).map(row => ({ caseNo: row.caseNo, action: row.action as "warn" | "kick" | "ban" | "timeout" | "quarantine",
            createdAt: row.createdAt, outcome: row.outcome as "pending" | "succeeded" | "failed" | "uncertain", reason: row.reason }))
        return { duplicate: false, type: "cases", cases, ...(rows.length > 10 ? { nextBeforeCaseNo: selected.at(-1)!.caseNo } : {}) }
    }
    if (op.type === "list") {
        const rows = await ctx.db.query("moderationAppeals").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("userId", userId)).order("desc").take(1001)
        const result = paged(rows, op.page === undefined ? 1 : integer(op.page, 1, 100)); return { duplicate: false, type: "appeals", appeals: result.rows.map(publicAppeal), page: result.page, totalPages: result.totalPages }
    }
    if (op.type === "submit") {
        const caseNo = integer(op.caseNo, 1, Number.MAX_SAFE_INTEGER); const row = await caseByNo(ctx, identity.serverId, caseNo)
        if (row.targetId !== userId) fail(404, "Case not found")
        if (!eligible(row)) fail(409, "Case not eligible")
        const prior = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", identity.serverId).eq("caseNo", caseNo).eq("userId", userId)).take(21)
        if (prior.some(a => a.status === "open")) fail(409, "Appeal already open")
        if (prior.length >= 20) fail(429, "Case appeal capacity reached")
        const next = await state(ctx, identity.serverId); const appealNo = next.nextAppealNo; await ctx.db.patch(next._id, { nextAppealNo: appealNo + 1 })
        const id = await ctx.db.insert("moderationAppeals", { serverId: identity.serverId, appealNo, caseNo, userId, text: text(op.text, 2000), createdAt: now, status: "open", erased: false })
        return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(id))!) }
    }
    if (op.type === "show" || op.type === "withdraw") {
        const appealNo = integer(op.appealNo, 1, Number.MAX_SAFE_INTEGER); const row = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId).eq("appealNo", appealNo)).unique()
        if (!row || row.userId !== userId) fail(404, "Appeal not found")
        if (op.type === "withdraw") { if (row.status !== "open") fail(409, "Appeal already closed"); await ctx.db.patch(row._id, { status: "withdrawn", decidedAt: now, expiresAt: now + RETENTION }) }
        return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(row._id))!) }
    }
    fail(400, "Invalid operation")
} })
export const staff = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AppealStaffResult> => {
    const input = object(request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const op = object(input.operation)
    if (input.privateChannelVerified !== true) fail(403, "Private channel required")
    const settings = config(await state(ctx, identity.serverId)); authorize(who, settings, "appeals", op.type !== "decide")
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (claim.duplicate) return { duplicate: true }
    if (op.type === "list") {
        const rows = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId)).order("desc").take(1001)
        const result = paged(rows, op.page === undefined ? 1 : integer(op.page, 1, 100))
        return { duplicate: false, type: "appeals", appeals: result.rows.map(publicAppeal), page: result.page, totalPages: result.totalPages }
    }
    const no = integer(op.appealNo, 1, Number.MAX_SAFE_INTEGER); const row = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId).eq("appealNo", no)).unique()
    if (!row) fail(404, "Appeal not found")
    if (op.type === "show") return { duplicate: false, type: "appeal", appeal: publicAppeal(row) }
    if (op.type !== "decide" || op.decision !== "accepted" && op.decision !== "rejected") fail(400, "Invalid operation")
    if (row.status !== "open") fail(409, "Appeal already closed")
    await ctx.db.patch(row._id, { status: op.decision, decisionReason: row.erased ? "[Erased by owner]" : text(op.reason), decidedAt: now, decidedBy: who.userId, expiresAt: now + RETENTION })
    return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(row._id))!) }
} })
