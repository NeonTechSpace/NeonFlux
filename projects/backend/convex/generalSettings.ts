import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { fail, isId, object } from "./validation.ts"

export const readGeneral = (ctx: QueryCtx | MutationCtx, serverId: string) => ctx.db.query("generalSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export function validPrefix(value: unknown): value is string {
    return typeof value === "string" && /^[!$%&*+,.?~^|:/\-]{1,5}$/.test(value)
}
export async function writePrefix(ctx: MutationCtx, serverId: string, actorId: string, prefix: unknown, expectedRevision: number) {
    if (!validPrefix(prefix)) fail(400, "Use one to five punctuation characters for the prefix")
    const old = await readGeneral(ctx, serverId), revision = old?.revision ?? 0
    if (revision !== expectedRevision) return { saved: false as const, conflict: true as const, revision }
    if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
    const next = { prefix, revision: revision + 1, updatedAt: Date.now(), updatedBy: actorId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("generalSettings", { serverId, ...next })
    return { saved: true as const, revision: next.revision }
}
export const get = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const row = await readGeneral(ctx, request.serverId)
    return { prefix: row?.prefix ?? "!", revision: row?.revision ?? 0 }
} })
export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = object(request)
    if (input.managerAuthorized !== true || !isId(input.actorId)) fail(403, "Manage Server permission required")
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) fail(400, "Invalid settings revision")
    return writePrefix(ctx, String(input.serverId), input.actorId, input.prefix, input.expectedRevision as number)
} })
