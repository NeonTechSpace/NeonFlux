import { v } from "convex/values"
import type { AfkObserveResult, AfkStatus } from "@neonflux/contracts/afk"
import { serviceMutation } from "./serviceGuard.ts"
import { afkObserveRequest, afkSetRequest } from "./afkDomain.ts"

export const setStatus = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AfkStatus> => {
        const { serverId, userId, reason: safeReason } = afkSetRequest(request)
        const existing = await ctx.db
            .query("afkStatuses")
            .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
            .unique()
        const status = { serverId, userId, reason: safeReason, since: Date.now() }
        if (existing) await ctx.db.replace(existing._id, status)
        else await ctx.db.insert("afkStatuses", status)
        return { userId, reason: safeReason, since: status.since }
    },
})

export const observeMessage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<AfkObserveResult> => {
        const { serverId, userId, mentionedUserIds: mentions } = afkObserveRequest(request)
        const ownStatus = await ctx.db
            .query("afkStatuses")
            .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
            .unique()
        if (ownStatus) await ctx.db.delete(ownStatus._id)

        const statuses = []
        for (const mentionedId of new Set(mentions)) {
            if (mentionedId === userId) continue
            const status = await ctx.db
                .query("afkStatuses")
                .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", mentionedId))
                .unique()
            if (status) statuses.push({ userId: status.userId, reason: status.reason, since: status.since })
        }
        return { cleared: ownStatus !== null, statuses }
    },
})
