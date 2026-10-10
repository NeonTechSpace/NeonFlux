import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { GeneralGetRequest, GeneralManageRequest, GeneralNicknameRequest, GeneralNicknameResultRequest, validNickname, validPrefix, type GeneralGetResult, type GeneralManageResult,
    type GeneralNickname, type GeneralNicknameRecordResult, type GeneralNicknameSetResult } from "@neonflux/contracts/general"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { describeChange, recordAudit, type AuditActor } from "./auditLog.ts"
import { decode, fail, fresh } from "./validation.ts"

export const readGeneral = (ctx: QueryCtx | MutationCtx, serverId: string) => ctx.db.query("generalSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const validReplyStyle = (value: unknown): value is "embed" | "text" => value === "embed" || value === "text"
export const generalView = (row: Doc<"generalSettings"> | null) => ({ prefix: row?.prefix ?? "!", replyStyle: row?.replyStyle ?? "embed" as const })
// Chat and the website both save the prefix and reply style here under one revision, which records each change in the audit log
export async function writeGeneral(ctx: MutationCtx, serverId: string, actor: AuditActor, change: { prefix?: unknown, replyStyle?: unknown }, expectedRevision: number) {
    if (change.prefix !== undefined && !validPrefix(change.prefix)) fail(400, "Use one to five punctuation characters for the prefix")
    if (change.replyStyle !== undefined && !validReplyStyle(change.replyStyle)) fail(400, "Use embed or text for the reply style")
    const old = await readGeneral(ctx, serverId), revision = old?.revision ?? 0
    if (revision !== expectedRevision) return { saved: false as const, conflict: true as const, revision }
    if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
    const before = generalView(old), after = { prefix: (change.prefix ?? before.prefix) as string, replyStyle: (change.replyStyle ?? before.replyStyle) as "embed" | "text" }
    const next = { ...after, revision: revision + 1, updatedAt: Date.now(), updatedBy: actor.userId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("generalSettings", { serverId, ...next })
    const supplied = (["prefix", "replyStyle"] as const).filter(key => change[key] !== undefined), changed = supplied.filter(key => before[key] !== after[key])
    // The audit log hides values under keys that look authored, such as reply, so the style is summarized as style
    for (const key of changed.length ? changed : supplied.slice(0, 1))
        await recordAudit(ctx, serverId, actor, { kind: "setting", feature: key === "prefix" ? "prefix" : "replies", setting: key, summary: describeChange({ [key === "prefix" ? key : "style"]: before[key] }, { [key === "prefix" ? key : "style"]: after[key] }) })
    return { saved: true as const, revision: next.revision }
}

// Fluxer accepts 1 to 32 UTF-16 code units. Surrounding spaces and control characters are rejected rather than normalized,
// so the nickname Fluxer returns can be compared exactly with the requested one
export function requireNickname(value: unknown): string | null {
    if (value === null) return null
    if (!validNickname(value)) fail(400, "Use 1 to 32 characters for the nickname, without control characters or surrounding spaces")
    return value
}
export function publicNickname(row: Doc<"generalSettings"> | null, revision: number): GeneralNickname {
    const result = row?.nicknameResult
    return { nickname: row?.nickname ?? null, revision, result: result ? { state: result.state, nickname: result.nickname, at: result.at, ...(result.error ? { error: result.error } : {}) } : null }
}
/** Record an explicit set or reset. The bot applies it natively and then reports the result for this revision */
export async function writeNickname(ctx: MutationCtx, serverId: string, actorId: string, nickname: string | null, revision: number) {
    const old = await readGeneral(ctx, serverId), now = Date.now()
    const nicknameResult = { state: "pending" as const, nickname, revision, at: now, actorId }
    if (old) await ctx.db.patch(old._id, { nickname: nickname ?? undefined, nicknameResult })
    else await ctx.db.insert("generalSettings", { serverId, prefix: "!", revision: 0, updatedAt: now, updatedBy: actorId, ...(nickname === null ? {} : { nickname }), nicknameResult })
}
export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GeneralGetResult> => {
    const { serverId } = decode(GeneralGetRequest, request), row = await readGeneral(ctx, serverId)
    return { ...generalView(row), revision: row?.revision ?? 0, nickname: publicNickname(row, await configurationRevision(ctx, serverId, "nickname")) }
} })
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GeneralManageResult> => {
    const input = decode(GeneralManageRequest, request)
    if (!input.managerAuthorized) fail(403, "Manage Server permission required")
    return writeGeneral(ctx, input.serverId, { userId: input.actorId, source: "command" }, "prefix" in input ? { prefix: input.prefix } : { replyStyle: input.replyStyle }, input.expectedRevision)
} })
export const nickname = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GeneralNicknameSetResult> => {
    const { serverId, actorId, managerAuthorized, createdAt, nickname: value } = decode(GeneralNicknameRequest, request)
    if (!managerAuthorized) fail(403, "Manage Server permission required")
    fresh(createdAt, Date.now())
    // The change records the revision it is about to take, which the revision bump after it confirms
    const revision = await changeConfiguration(ctx, serverId, "nickname", { kind: "chat", createdAt, actor: { userId: actorId, source: "command" }, operation: { type: value === null ? "reset" : "set" } }, async () => {
        const next = await configurationRevision(ctx, serverId, "nickname") + 1
        await writeNickname(ctx, serverId, actorId, value, next)
        return next
    })
    return { revision }
} })
/** Only the result for the latest explicit change is kept. A late result for an older change is ignored */
export const nicknameResult = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GeneralNicknameRecordResult> => {
    const { serverId, revision, nickname: value, state, error } = decode(GeneralNicknameResultRequest, request, "Invalid nickname result")
    const row = await readGeneral(ctx, serverId), pending = row?.nicknameResult
    if (!row || !pending || pending.revision !== revision || pending.nickname !== value || await configurationRevision(ctx, serverId, "nickname") !== revision) return { recorded: false }
    const { error: _previous, ...rest } = pending
    await ctx.db.patch(row._id, { nicknameResult: { ...rest, state, at: Date.now(), ...(state === "failed" ? { error: error ?? "Fluxer did not confirm the nickname" } : {}) } })
    return { recorded: true }
} })
