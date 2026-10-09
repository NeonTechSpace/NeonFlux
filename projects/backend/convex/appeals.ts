import { v } from "convex/values"
import { AppealMemberRequest, AppealStaffRequest, type AppealMemberResult, type AppealStaffResult } from "@neonflux/contracts/appeal"
import { serviceMutation } from "./installations.ts"
import { actor, authorize, RETENTION } from "./moderationDomain.ts"
import { caseByNo, config, publicAppeal, receipt, state } from "./moderationStore.ts"
import type { Doc } from "./_generated/dataModel.js"
import { decode, fail, source } from "./validation.ts"

// Ten appeals, newest first, and where the next page starts when there are more
const appealPage = (rows: Doc<"moderationAppeals">[]) => {
    const selected = rows.slice(0, 10)
    return { duplicate: false as const, type: "appeals" as const, appeals: selected.map(publicAppeal), ...(rows.length > 10 ? { nextBeforeAppealNo: selected.at(-1)!.appealNo } : {}) }
}
const eligible = (row: { action: string, outcome: string, erased: boolean, voided: boolean }) => !row.erased && !row.voided && row.outcome !== "failed" && ["warn", "kick", "ban", "timeout", "quarantine"].includes(row.action)
export const member = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AppealMemberResult> => {
    const input = decode(AppealMemberRequest, request); const now = Date.now(); const identity = source(input, now); const userId = input.requesterId; const op = input.operation
    if (!input.privateChannelVerified) fail(403, "Private channel required")
    const current = await state(ctx, identity.serverId); const settings = config(current)
    if (!settings.appealsEnabled || settings.defcon === 1) fail(403, "Appeals unavailable")
    const claim = await receipt(ctx, identity.serverId, `appeal:${identity.messageId}`, now)
    if (claim.duplicate) return { duplicate: true }
    if (op.type === "cases") {
        const before = op.beforeCaseNo ?? Number.MAX_SAFE_INTEGER
        const rows = await ctx.db.query("moderationCases").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("targetId", userId).lt("caseNo", before)).order("desc").take(11)
        const selected = rows.slice(0, 10)
        const cases = selected.filter(eligible).map(row => ({ caseNo: row.caseNo, action: row.action as "warn" | "kick" | "ban" | "timeout" | "quarantine",
            createdAt: row.createdAt, outcome: row.outcome as "pending" | "succeeded" | "failed" | "uncertain", reason: row.reason }))
        return { duplicate: false, type: "cases", cases, ...(rows.length > 10 ? { nextBeforeCaseNo: selected.at(-1)!.caseNo } : {}) }
    }
    if (op.type === "list") {
        const rows = await ctx.db.query("moderationAppeals").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("userId", userId).lt("appealNo", op.beforeAppealNo ?? Number.MAX_SAFE_INTEGER)).order("desc").take(11)
        return appealPage(rows)
    }
    if (op.type === "submit") {
        const caseNo = op.caseNo; const row = await caseByNo(ctx, identity.serverId, caseNo)
        if (row.targetId !== userId) fail(404, "Case not found")
        if (!eligible(row)) fail(409, "Case not eligible")
        const prior = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", identity.serverId).eq("caseNo", caseNo).eq("userId", userId)).take(21)
        if (prior.some(a => a.status === "open")) fail(409, "Appeal already open")
        if (prior.length >= 20) fail(429, "Case appeal capacity reached")
        const next = await state(ctx, identity.serverId); const appealNo = next.nextAppealNo; await ctx.db.patch(next._id, { nextAppealNo: appealNo + 1 })
        const id = await ctx.db.insert("moderationAppeals", { serverId: identity.serverId, appealNo, caseNo, userId, text: op.text, createdAt: now, status: "open", erased: false })
        return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(id))!) }
    }
    const row = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId).eq("appealNo", op.appealNo)).unique()
    if (!row || row.userId !== userId) fail(404, "Appeal not found")
    if (op.type === "withdraw") { if (row.status !== "open") fail(409, "Appeal already closed"); await ctx.db.patch(row._id, { status: "withdrawn", decidedAt: now, expiresAt: now + RETENTION }) }
    return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(row._id))!) }
} })
export const staff = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<AppealStaffResult> => {
    const input = decode(AppealStaffRequest, request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const op = input.operation
    if (!input.privateChannelVerified) fail(403, "Private channel required")
    const settings = config(await state(ctx, identity.serverId)); authorize(who, settings, "appeals", op.type !== "decide")
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (claim.duplicate) return { duplicate: true }
    if (op.type === "list") {
        return appealPage(await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId).lt("appealNo", op.beforeAppealNo ?? Number.MAX_SAFE_INTEGER)).order("desc").take(11))
    }
    const row = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", identity.serverId).eq("appealNo", op.appealNo)).unique()
    if (!row) fail(404, "Appeal not found")
    if (op.type === "show") return { duplicate: false, type: "appeal", appeal: publicAppeal(row) }
    if (row.status !== "open") fail(409, "Appeal already closed")
    await ctx.db.patch(row._id, { status: op.decision, decisionReason: row.erased ? "[Erased by owner]" : op.reason, decidedAt: now, decidedBy: who.userId, expiresAt: now + RETENTION })
    return { duplicate: false, type: "appeal", appeal: publicAppeal((await ctx.db.get(row._id))!) }
} })
