import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { StickyListResult, StickyManageResult, StickyMessage, StickyOperation, StickyPostedResult } from "../contracts.js"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer, requireId, source } from "./validation.ts"
import { STICKY_DEFAULT_INTERVAL, STICKY_LIMIT, stickyOperation } from "./stickyDomain.ts"

type Read = QueryCtx | MutationCtx
export const publicSticky = (row: Doc<"stickyMessages">): StickyMessage => ({ channelId: row.channelId, content: row.content, intervalSeconds: row.intervalSeconds,
    messageId: row.messageId, revision: row.revision, updatedAt: row.updatedAt })
export const readStickies = (ctx: Read, serverId: string) => ctx.db.query("stickyMessages").withIndex("by_channel", q => q.eq("serverId", serverId)).take(STICKY_LIMIT)
const stickyRow = (ctx: Read, serverId: string, channelId: string) => ctx.db.query("stickyMessages").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId)).unique()

// The bot reads the list once when a server starts and keeps it in memory, so ordinary messages cost no backend call
export const list = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<StickyListResult> => {
    const input = shape(request, ["serverId"], ["serverId"])
    return { stickies: (await readStickies(ctx, String(input.serverId))).map(publicSticky) }
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<StickyManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"])
    const identity = source(input, Date.now()), who = actor(input.actor)
    if (input.managerAuthorized !== true || !who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    const op = stickyOperation(input.operation)
    return changeConfiguration(ctx, identity.serverId, "sticky", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applyStickyManagement(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, op))
} })

// Chat and dashboard share these rules
export async function applyStickyManagement(ctx: MutationCtx, identity: ConfigurationIdentity, op: StickyOperation): Promise<StickyManageResult> {
    const serverId = identity.serverId, row = await stickyRow(ctx, serverId, op.channelId), now = Date.now()
    if (op.type === "remove") {
        if (!row) fail(404, "This channel has no sticky message")
        await ctx.db.delete(row._id)
        return { type: "removed", sticky: publicSticky(row) }
    }
    if (!row) {
        if (op.content === undefined) fail(404, "This channel has no sticky message")
        if ((await readStickies(ctx, serverId)).length >= STICKY_LIMIT) fail(429, `A server can have at most ${STICKY_LIMIT} sticky messages`)
        const id = await ctx.db.insert("stickyMessages", { serverId, channelId: op.channelId, content: op.content, intervalSeconds: op.intervalSeconds ?? STICKY_DEFAULT_INTERVAL,
            messageId: null, revision: 1, updatedAt: now, updatedBy: identity.actorId })
        return { type: "saved", sticky: publicSticky((await ctx.db.get(id))!) }
    }
    await ctx.db.patch(row._id, { ...(op.content === undefined ? {} : { content: op.content }), ...(op.intervalSeconds === undefined ? {} : { intervalSeconds: op.intervalSeconds }),
        revision: row.revision + 1, updatedAt: now, updatedBy: identity.actorId })
    return { type: "saved", sticky: publicSticky((await ctx.db.get(row._id))!) }
}

// A repost records its new copy only if no other repost or change came first. The loser deletes its own copy
export const posted = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<StickyPostedResult> => {
    const input = shape(request, ["serverId", "channelId", "revision", "previousMessageId", "messageId"], ["serverId", "channelId", "revision", "previousMessageId", "messageId"])
    const row = await stickyRow(ctx, String(input.serverId), requireId(input.channelId)), revision = integer(input.revision, 1, Number.MAX_SAFE_INTEGER), messageId = requireId(input.messageId)
    const previous = input.previousMessageId === null ? null : requireId(input.previousMessageId)
    if (!row || row.revision !== revision || row.messageId !== previous) return { accepted: false, sticky: row ? publicSticky(row) : null }
    await ctx.db.patch(row._id, { messageId })
    return { accepted: true, sticky: publicSticky((await ctx.db.get(row._id))!) }
} })
