import type { SchedulesContext, SchedulesMemberContext } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { actor, administrator } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, requireId, bool, ids, integer } from "./validation.ts"
function epoch(value: unknown): string {
    if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, "Invalid membership epoch")
    return value
}
// Fresh actor, channel and member observations shared by publishing consumers
export function eventContext(value: unknown, now = Date.now()): SchedulesContext {
    const r = shape(value, ["observedAt", "actor", "channelId", "botId", "botAuthorized", "actorAuthorized", "member"], ["observedAt", "actor", "channelId", "botId", "botAuthorized", "actorAuthorized"])
    const observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    shape(r.actor, ["userId", "roleIds", "isOwner", "isAdministrator", "nativePermissionAuthorized"], ["userId", "roleIds", "isOwner", "isAdministrator", "nativePermissionAuthorized"])
    return { observedAt, actor: actor(r.actor), channelId: requireId(r.channelId), botId: requireId(r.botId), botAuthorized: bool(r.botAuthorized), actorAuthorized: bool(r.actorAuthorized), ...(r.member !== undefined ? { member: eventMember(r.member, observedAt) } : {}) }
}
export function eventMember(value: unknown, observedAt: number): SchedulesMemberContext {
    const r = shape(value, ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil", "canView", "canReadHistory"], ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil", "canView", "canReadHistory"])
    const joinedAt = epoch(r.joinedAt)
    if (Date.parse(joinedAt) > observedAt) fail(400, "Membership observation predates join")
    return { userId: requireId(r.userId), joinedAt, roleIds: ids(r.roleIds, 1000), isBot: bool(r.isBot), timeoutUntil: r.timeoutUntil === null ? null : epoch(r.timeoutUntil), canView: bool(r.canView), canReadHistory: bool(r.canReadHistory) }
}
export async function eventAdmin(ctx: MutationCtx | QueryCtx, serverId: string, context: SchedulesContext, critical = false) {
    if (!administrator(context.actor) || !context.actor.nativePermissionAuthorized) fail(403, "Current Owner or Administrator required")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
}
