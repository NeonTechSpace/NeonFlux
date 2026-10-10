import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { SidebarLink, SidebarOperation, SidebarResult } from "../contracts.js"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, source } from "./validation.ts"
import { sidebarOperation } from "./sidebarDomain.ts"

export const publicSidebarLink = (row: Doc<"sidebarLinks">): SidebarLink => ({ channelId: row.channelId, revision: row.revision, updatedAt: row.updatedAt })
export const readSidebarLink = (ctx: QueryCtx | MutationCtx, serverId: string) => ctx.db.query("sidebarLinks").withIndex("by_server", q => q.eq("serverId", serverId)).unique()

export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SidebarResult> => {
    const row = await readSidebarLink(ctx, String(shape(request, ["serverId"], ["serverId"]).serverId))
    return { link: row ? publicSidebarLink(row) : null }
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SidebarResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"])
    const identity = source(input, Date.now()), who = actor(input.actor)
    if (input.managerAuthorized !== true || !who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    const op = sidebarOperation(input.operation)
    return changeConfiguration(ctx, identity.serverId, "sidebar", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applySidebarManagement(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, op))
} })

// Chat and dashboard share these rules. The bot has already created, renamed or deleted the channel natively
export async function applySidebarManagement(ctx: MutationCtx, identity: ConfigurationIdentity, op: SidebarOperation): Promise<SidebarResult> {
    const row = await readSidebarLink(ctx, identity.serverId), now = Date.now()
    if (op.type === "add") {
        if (row) fail(409, "This server already has a dashboard link")
        const id = await ctx.db.insert("sidebarLinks", { serverId: identity.serverId, channelId: op.channelId, revision: 1, updatedAt: now, updatedBy: identity.actorId })
        return { link: publicSidebarLink((await ctx.db.get(id))!) }
    }
    if (!row) fail(404, "This server has no dashboard link")
    if (op.type === "remove") { await ctx.db.delete(row._id); return { link: null } }
    await ctx.db.patch(row._id, { revision: row.revision + 1, updatedAt: now, updatedBy: identity.actorId })
    return { link: publicSidebarLink((await ctx.db.get(row._id))!) }
}
