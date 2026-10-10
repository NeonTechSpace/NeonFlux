import type { AutomodRule, ModerationCase, ModerationSettings, SecurityRecovery } from "@neonflux/contracts/moderation"
import type { Appeal } from "@neonflux/contracts/appeal"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { DAY, defaultSettings } from "./moderationDomain.ts"
import { fail } from "./validation.ts"

export type ReadCtx = MutationCtx | QueryCtx
export async function readSettings(ctx: ReadCtx, serverId: string) {
    return ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
}
export async function state(ctx: MutationCtx, serverId: string) {
    const old = await readSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("moderationSettings", { serverId, config: defaultSettings(), nextCaseNo: 1, nextAppealNo: 1 })
    return (await ctx.db.get(id))!
}
// Settings saved before a later setting existed take its default
export function config(row: Doc<"moderationSettings"> | null): ModerationSettings { return { ...defaultSettings(), ...row?.config } }
// Source dedup only: gateway redelivery of the same message or join must not repeat its effect
export async function receipt(ctx: MutationCtx, serverId: string, key: string, now: number) {
    const old = await ctx.db.query("moderationReceipts").withIndex("by_server_key", q => q.eq("serverId", serverId).eq("key", key)).unique()
    if (old) return { row: old, duplicate: true }
    const id = await ctx.db.insert("moderationReceipts", { serverId, key, expiresAt: now + DAY, claimed: false, blocked: false, createCounted: false, versions: [] })
    return { row: (await ctx.db.get(id))!, duplicate: false }
}
export async function caseByNo(ctx: ReadCtx, serverId: string, caseNo: number) {
    const row = await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).eq("caseNo", caseNo)).unique()
    if (!row) fail(404, "Case not found")
    return row
}
export async function publicCase(ctx: ReadCtx, row: Doc<"moderationCases">): Promise<ModerationCase> {
    const corrections = await ctx.db.query("moderationCorrections").withIndex("by_case", q => q.eq("caseId", row._id)).take(21)
    return { caseNo: row.caseNo, actionId: row._id, sourceId: row.sourceId,
        action: row.action as ModerationCase["action"], origin: row.origin as ModerationCase["origin"],
        ...(row.incident ? { incident: row.incident } : {}),
        ...(row.actorId ? { actorId: row.actorId } : {}), ...(row.targetId ? { targetId: row.targetId } : {}),
        ...(row.channelId ? { channelId: row.channelId } : {}), reason: row.reason,
        ...(row.ruleName ? { ruleName: row.ruleName } : {}), ...(row.linkedCaseNo ? { linkedCaseNo: row.linkedCaseNo } : {}),
        createdAt: row.createdAt, expiresAt: row.expiresAt, outcome: row.outcome as ModerationCase["outcome"],
        logOutcome: row.logOutcome as ModerationCase["logOutcome"],
        notificationOutcome: row.notificationOutcome as ModerationCase["notificationOutcome"], erased: row.erased, voided: row.voided,
        corrections: corrections.map(c => ({ actorId: c.actorId, createdAt: c.createdAt, previousReason: c.previousReason, reason: c.reason, type: c.type as "reason" | "void" })),
        ...(row.observation ? { observation: row.observation } : {}) }
}
export function publicRule(row: Doc<"automodRules">): AutomodRule { return row.rule }
export function publicRecovery(row: Doc<"securityRecoveries">): SecurityRecovery {
    return { recoveryId: row._id, generation: row.generation, type: row.type, caseNo: row.caseNo, status: row.status, createdAt: row.createdAt,
        ...(row.targetId ? { targetId: row.targetId } : {}), ...(row.channelId ? { channelId: row.channelId } : {}),
        ...(row.expectedTimeoutUntil !== undefined ? { expectedTimeoutUntil: row.expectedTimeoutUntil } : {}),
        ...(row.previousTimeoutUntil !== undefined ? { previousTimeoutUntil: row.previousTimeoutUntil } : {}),
        ...(row.previousOverwrite ? { previousOverwrite: row.previousOverwrite } : {}), ...(row.expectedOverwrite ? { expectedOverwrite: row.expectedOverwrite } : {}),
        ...(row.knownDeadline !== undefined ? { knownDeadline: row.knownDeadline } : {}) }
}
export function publicAppeal(row: Doc<"moderationAppeals">): Appeal {
    return { appealNo: row.appealNo, caseNo: row.caseNo, userId: row.userId, text: row.text, createdAt: row.createdAt, status: row.status, erased: row.erased,
        ...(row.decisionReason !== undefined ? { decisionReason: row.decisionReason } : {}), ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}) }
}
export async function retireRecovery(ctx: MutationCtx, row: Doc<"securityRecoveries">) { await ctx.db.delete(row._id) }
// An active recovery whose known deadline has passed is one retention would delete, so it no longer restricts its member
export const recoveryElapsed = (row: Doc<"securityRecoveries">, now: number) => row.status === "active" && row.knownDeadline !== undefined && row.knownDeadline <= now
// The member's recovery rows, counting at most 11 for the callers' limit of ten, and the cases of those still restricting,
// null where a case is missing
export async function memberRecoveries(ctx: ReadCtx, serverId: string, userId: string, now = Date.now()) {
    const rows = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", serverId).eq("targetId", userId)).take(11)
    const cases: (Doc<"moderationCases"> | null)[] = []
    for (const row of rows) if (!recoveryElapsed(row, now)) cases.push(await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).eq("caseNo", row.caseNo)).unique())
    return { count: rows.length, cases }
}
export function paged<T>(rows: T[], page: number) {
    const totalPages = Math.max(1, Math.ceil(rows.length / 10))
    if (page > totalPages) fail(400, "Invalid page")
    return { rows: rows.slice((page - 1) * 10, page * 10), page, totalPages }
}
