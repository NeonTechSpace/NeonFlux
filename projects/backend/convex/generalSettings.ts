import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    GeneralGetRequest,
    GeneralManageRequest,
    validPrefix,
    type GeneralGetResult,
    type GeneralManageResult,
} from "@neonflux/contracts/general"
import { decode, fail } from "./validation.ts"

export const readGeneral = (ctx: QueryCtx | MutationCtx, serverId: string) =>
    ctx.db
        .query("generalSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const generalView = (row: Doc<"generalSettings"> | null) => ({
    prefix: row?.prefix ?? "!",
})
// Chat and the website both save the prefix here
export async function writeGeneral(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    change: { prefix: unknown },
    expectedRevision: number,
) {
    if (!validPrefix(change.prefix)) fail(400, "Use one to five punctuation characters for the prefix")
    const old = await readGeneral(ctx, serverId),
        revision = old?.revision ?? 0
    if (revision !== expectedRevision) return { saved: false as const, conflict: true as const, revision }
    if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
    const next = { prefix: change.prefix, revision: revision + 1, updatedAt: Date.now(), updatedBy: actorId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("generalSettings", { serverId, ...next })
    return { saved: true as const, revision: next.revision }
}
export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralGetResult> => {
        const { serverId } = decode(GeneralGetRequest, request),
            row = await readGeneral(ctx, serverId)
        return {
            ...generalView(row),
            revision: row?.revision ?? 0,
        }
    },
})
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralManageResult> => {
        const input = decode(GeneralManageRequest, request)
        if (!input.managerAuthorized) fail(403, "Manage community permission required")
        return writeGeneral(ctx, input.serverId, input.actorId, { prefix: input.prefix }, input.expectedRevision)
    },
})
