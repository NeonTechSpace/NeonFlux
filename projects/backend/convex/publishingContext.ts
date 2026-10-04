import { SchedulesContext, SchedulesMemberContext } from "@neonflux/contracts/schedules"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { actor, administrator } from "./moderationDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { decode, fail, ids, integer } from "./validation.ts"
// Fresh actor, channel and member observations shared by publishing consumers
export function eventContext(value: unknown, now = Date.now()): SchedulesContext {
    const r = decode(SchedulesContext, value), observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    return { observedAt, actor: actor(r.actor), channelId: r.channelId, botId: r.botId, botAuthorized: r.botAuthorized, actorAuthorized: r.actorAuthorized, ...(r.member !== undefined ? { member: eventMember(r.member, observedAt) } : {}) }
}
export function eventMember(value: unknown, observedAt: number): SchedulesMemberContext {
    const r = decode(SchedulesMemberContext, value)
    const joinedAt = epoch(r.joinedAt)
    if (Date.parse(joinedAt) > observedAt) fail(400, "Membership observation predates join")
    return { userId: r.userId, joinedAt, roleIds: ids(r.roleIds, 1000), isBot: r.isBot, timeoutUntil: r.timeoutUntil === null ? null : epoch(r.timeoutUntil), canView: r.canView, canReadHistory: r.canReadHistory }
}
export async function eventAdmin(ctx: MutationCtx | QueryCtx, serverId: string, context: SchedulesContext, critical = false) {
    if (!administrator(context.actor) || !context.actor.nativePermissionAuthorized) fail(403, "Current Owner or Administrator required")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
}
