import { SchedulesContext } from "@neonflux/contracts/schedules"
import { ChannelMemberContext } from "@neonflux/contracts/shared"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { actor, administrator } from "./moderationDomain.ts"
import { decode, fail, ids, integer, epoch } from "./validation.ts"
// Fresh actor, channel and member observations shared by publishing consumers
export function composerContext(value: unknown, now = Date.now()): SchedulesContext {
    const r = decode(SchedulesContext, value),
        observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    return {
        observedAt,
        actor: actor(r.actor),
        channelId: r.channelId,
        botId: r.botId,
        botAuthorized: r.botAuthorized,
        actorAuthorized: r.actorAuthorized,
        ...(r.member !== undefined ? { member: composerMember(r.member, observedAt) } : {}),
    }
}
function composerMember(value: unknown, observedAt: number): ChannelMemberContext {
    const r = decode(ChannelMemberContext, value)
    const joinedAt = epoch(r.joinedAt)
    if (Date.parse(joinedAt) > observedAt) fail(400, "Membership observation predates join")
    return {
        userId: r.userId,
        joinedAt,
        roleIds: ids(r.roleIds, 1000),
        isBot: r.isBot,
        timeoutUntil: r.timeoutUntil === null ? null : epoch(r.timeoutUntil),
    }
}
export async function composerAdmin(
    ctx: MutationCtx | QueryCtx,
    serverId: string,
    context: SchedulesContext,
    critical = false,
) {
    if (!administrator(context.actor) || !context.actor.nativePermissionAuthorized)
        fail(403, "Current Owner or Administrator required")
    const moderation = await ctx.db
        .query("moderationSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
}
