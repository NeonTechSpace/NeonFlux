import { EventsContext } from "@neonflux/contracts/events"
import { EventsMemberContext } from "@neonflux/contracts/shared"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { actor, administrator } from "./moderationDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { onboardingProtection } from "./roleClaims.ts"
import { readRolesSettings, rolesAcknowledgment } from "./rolesStore.ts"
import { decode, fail, ids, integer } from "./validation.ts"
// Fresh actor, channel and member observations shared by publishing consumers
export function eventContext(value: unknown, now = Date.now()): EventsContext {
    const r = decode(EventsContext, value), observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    return { observedAt, actor: actor(r.actor), channelId: r.channelId, botId: r.botId, botAuthorized: r.botAuthorized, actorAuthorized: r.actorAuthorized, ...(r.member !== undefined ? { member: eventMember(r.member, observedAt) } : {}) }
}
export function eventMember(value: unknown, observedAt: number): EventsMemberContext {
    const r = decode(EventsMemberContext, value)
    const joinedAt = epoch(r.joinedAt)
    if (Date.parse(joinedAt) > observedAt) fail(400, "Membership observation predates join")
    return { userId: r.userId, joinedAt, roleIds: ids(r.roleIds, 1000), isBot: r.isBot, timeoutUntil: r.timeoutUntil === null ? null : epoch(r.timeoutUntil), canView: r.canView, canReadHistory: r.canReadHistory }
}
export async function eventAdmin(ctx: MutationCtx | QueryCtx, serverId: string, context: EventsContext, critical = false) {
    if (!administrator(context.actor) || !context.actor.nativePermissionAuthorized) fail(403, "Current Owner or Administrator required")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
}
export async function eventEligible(ctx: MutationCtx | QueryCtx, serverId: string, context: EventsContext, channelId: string, userId?: string) {
    const member = context.member
    if (context.channelId !== channelId || !context.botAuthorized || !member || member.isBot || member.userId === context.botId || !member.canView || !member.canReadHistory || userId !== undefined && member.userId !== userId) fail(403, "Current visible membership required")
    await onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
    const panel = await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", "verification")).unique()
    if (panel && (panel.published || panel.mappings.length)) {
        const settings = await readRolesSettings(ctx, serverId), ack = await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds)
        if (!settings?.config.verificationEnabled || !panel.enabled || panel.withdrawing || !panel.published || panel.published.revision !== panel.revision || !ack.accessConfirmed || !ack.accessRolePresent) fail(403, "Verified membership required")
    }
    return member
}
