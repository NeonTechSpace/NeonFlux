import { v } from "convex/values"
import { serviceMutation } from "./installations.ts"
import { requireServer } from "./validation.ts"
import { requireAfkMember, requireAfkMentions, requireAfkReason } from "./afkDomain.ts"

export const setStatus = serviceMutation({
    args: { serverId: v.string(), userId: v.string(), reason: v.string() },
    handler: async (ctx, { serverId, userId, reason }) => {
        requireServer(serverId)
        requireAfkMember(userId)
        const safeReason = requireAfkReason(reason)
        const existing = await ctx.db.query("afkStatuses")
            .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
            .unique()
        const status = { serverId, userId, reason: safeReason, since: Date.now() }
        if (existing) await ctx.db.replace(existing._id, status)
        else await ctx.db.insert("afkStatuses", status)
        return { userId, reason: safeReason, since: status.since }
    },
})

export const observeMessage = serviceMutation({
    args: { serverId: v.string(), userId: v.string(), mentionedUserIds: v.array(v.string()) },
    handler: async (ctx, { serverId, userId, mentionedUserIds }) => {
        requireServer(serverId)
        requireAfkMember(userId)
        const mentions = requireAfkMentions(mentionedUserIds)
        const ownStatus = await ctx.db.query("afkStatuses")
            .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
            .unique()
        if (ownStatus) await ctx.db.delete(ownStatus._id)

        const statuses = []
        for (const mentionedId of new Set(mentions)) {
            if (mentionedId === userId) continue
            const status = await ctx.db.query("afkStatuses")
                .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", mentionedId))
                .unique()
            if (status) statuses.push({ userId: status.userId, reason: status.reason, since: status.since })
        }
        return { cleared: ownStatus !== null, statuses }
    },
})
