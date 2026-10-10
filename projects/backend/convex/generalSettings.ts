import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { GeneralNickname } from "../contracts.js"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { describeChange, recordAudit, type AuditActor } from "./auditLog.ts"
import { fail, fresh, integer, isId, object } from "./validation.ts"

export const readGeneral = (ctx: QueryCtx | MutationCtx, serverId: string) => ctx.db.query("generalSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export function validPrefix(value: unknown): value is string {
    return typeof value === "string" && /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)
}
// Chat and the website both save the prefix here, which records the change in the audit log
export async function writePrefix(ctx: MutationCtx, serverId: string, actor: AuditActor, prefix: unknown, expectedRevision: number) {
    if (!validPrefix(prefix)) fail(400, "Use one to five punctuation characters for the prefix")
    const old = await readGeneral(ctx, serverId), revision = old?.revision ?? 0
    if (revision !== expectedRevision) return { saved: false as const, conflict: true as const, revision }
    if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
    const next = { prefix, revision: revision + 1, updatedAt: Date.now(), updatedBy: actor.userId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("generalSettings", { serverId, ...next })
    await recordAudit(ctx, serverId, actor, { kind: "setting", feature: "prefix", setting: "prefix", summary: describeChange({ prefix: old?.prefix ?? "!" }, { prefix }) })
    return { saved: true as const, revision: next.revision }
}

// Fluxer accepts 1 to 32 UTF-16 code units. Surrounding spaces and control characters are rejected rather than normalized,
// so the nickname Fluxer returns can be compared exactly with the requested one
export function validNickname(value: unknown): value is string {
    return typeof value === "string" && value.length >= 1 && value.length <= 32 && value.trim() === value && !/[\u0000-\u001f\u007f\u202e]/.test(value)
}
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
export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const row = await readGeneral(ctx, request.serverId)
    return { prefix: row?.prefix ?? "!", revision: row?.revision ?? 0, nickname: publicNickname(row, await configurationRevision(ctx, request.serverId, "nickname")) }
} })
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = object(request)
    if (input.managerAuthorized !== true || !isId(input.actorId)) fail(403, "Manage Server permission required")
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) fail(400, "Invalid settings revision")
    return writePrefix(ctx, String(input.serverId), { userId: input.actorId, source: "command" }, input.prefix, input.expectedRevision as number)
} })
export const nickname = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = object(request), serverId = String(input.serverId)
    if (input.managerAuthorized !== true || !isId(input.actorId)) fail(403, "Manage Server permission required")
    const value = requireNickname(input.nickname), createdAt = integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER), actorId = input.actorId
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
export const nicknameResult = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = object(request), serverId = String(input.serverId), revision = integer(input.revision, 1, Number.MAX_SAFE_INTEGER), value = requireNickname(input.nickname)
    if (input.state !== "applied" && input.state !== "failed") fail(400, "Invalid nickname result")
    if (input.error !== undefined && (typeof input.error !== "string" || !input.error || input.error.length > 200)) fail(400, "Invalid nickname result")
    const row = await readGeneral(ctx, serverId), pending = row?.nicknameResult
    if (!row || !pending || pending.revision !== revision || pending.nickname !== value || await configurationRevision(ctx, serverId, "nickname") !== revision) return { recorded: false }
    const { error: _previous, ...rest } = pending
    await ctx.db.patch(row._id, { nicknameResult: { ...rest, state: input.state, at: Date.now(), ...(input.state === "failed" ? { error: String(input.error ?? "Fluxer did not confirm the nickname") } : {}) } })
    return { recorded: true }
} })
