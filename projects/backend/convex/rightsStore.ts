import {
    defaultRightsSettings,
    RIGHTS_MAX_MINUTES,
    RIGHTS_SERVER_FACTOR,
    rightForAction,
    type BotRight,
    type RightsSettings,
} from "@neonflux/contracts/rights"
import type { ModerationActionContext } from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { admitSecurityRecord } from "./lockdownStore.ts"

type Read = QueryCtx | MutationCtx
const MINUTE = 60000
export const RIGHTS_SUSPENDED =
    "Your bot-only rights are suspended. The server owner can lift that with !mod rights clear"
export const readRights = (ctx: Read, serverId: string) =>
    ctx.db
        .query("rightsSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicRights = (row: Doc<"rightsSettings"> | null): RightsSettings =>
    row ? { enabled: row.enabled, grants: row.grants, limits: row.limits } : defaultRightsSettings()
export const readSuspension = (ctx: Read, serverId: string, userId: string) =>
    ctx.db
        .query("rightsSuspensions")
        .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
        .unique()
/** The roles of a grant that hold a right, out of the ones the bot read on the member */
const holdingRoles = (settings: RightsSettings, right: BotRight, roleIds: readonly string[]) =>
    settings.grants
        .filter((grant) => grant.rights.includes(right) && roleIds.includes(grant.roleId))
        .map((grant) => grant.roleId)

/**
 * The one decision of whether an actor with no real permission may act through a bot-only right, from the stored grants and the bot's fresh
 * read of the actor, in the transaction that uses it. A role must be on the actor in that read and rank below NeonFlux, a channel action
 * needs an actor who can view the channel, and a suspended member holds nothing. It never answers for an actor who has the real permission,
 * since that member acts natively and no right is involved
 */
export async function rightFor(
    ctx: Read,
    serverId: string,
    who: ModerationActor,
    action: string,
    context: Pick<ModerationActionContext, "rightRoleIds" | "actorViewsChannel"> | undefined,
    channelAction: boolean,
) {
    if (who.nativePermissionAuthorized) return undefined
    const right = rightForAction(action)
    if (!right) return undefined
    const settings = publicRights(await readRights(ctx, serverId))
    if (!settings.enabled) return undefined
    const usable = (context?.rightRoleIds ?? []).filter((id) => who.roleIds.includes(id))
    const roleIds = holdingRoles(settings, right, usable)
    if (!roleIds.length || (channelAction && context?.actorViewsChannel !== true)) return undefined
    return {
        right,
        roleIds,
        suspended: (await readSuspension(ctx, serverId, who.userId)) !== null,
        limit: settings.limits[right],
    }
}

/** Writes a suspension once and its security record. A member already suspended stays suspended for the first reason */
export async function suspendRights(
    ctx: MutationCtx,
    serverId: string,
    userId: string,
    reason: "limit" | "anti-nuke",
    now: number,
    right?: BotRight,
) {
    if (await readSuspension(ctx, serverId, userId)) return { suspended: false, admitted: false }
    await ctx.db.insert("rightsSuspensions", { serverId, userId, reason, ...(right ? { right } : {}), at: now })
    return {
        suspended: true,
        admitted: await admitSecurityRecord(ctx, serverId, `rights:${userId}:${now}:${reason}`, {
            type: "bot-rights",
            resourceIds: [userId],
            changedFields: [reason === "limit" ? "rights-limit" : "rights-anti-nuke"],
        }),
    }
}

/**
 * Counts one use of a right, atomically with the action it allows. Going over the member's own limit suspends the member, and going over the
 * server's ceiling refuses without suspending, since the other members' actions put it there. A throw later in the same transaction takes
 * the count back, so an action the backend refuses for another reason costs nothing, and a retried or unconfirmed action is never counted twice
 */
export async function spendRight(
    ctx: MutationCtx,
    serverId: string,
    userId: string,
    via: { right: BotRight; limit: { count: number; minutes: number } },
    now: number,
): Promise<{ reason: "limit" | "ceiling"; admitted: boolean } | undefined> {
    const { right, limit } = via
    const since = now - limit.minutes * MINUTE
    const mine = await ctx.db
        .query("rightsUsage")
        .withIndex("by_member_right", (q) =>
            q.eq("serverId", serverId).eq("userId", userId).eq("right", right).gt("at", since),
        )
        .take(limit.count)
    if (mine.length >= limit.count)
        return { reason: "limit", admitted: (await suspendRights(ctx, serverId, userId, "limit", now, right)).admitted }
    const ceiling = limit.count * RIGHTS_SERVER_FACTOR
    const all = await ctx.db
        .query("rightsUsage")
        .withIndex("by_server_right", (q) => q.eq("serverId", serverId).eq("right", right).gt("at", since))
        .take(ceiling)
    if (all.length >= ceiling)
        return {
            reason: "ceiling",
            admitted: await admitSecurityRecord(ctx, serverId, `rights:${right}:${Math.floor(now / MINUTE)}:ceiling`, {
                type: "bot-rights",
                resourceIds: [userId],
                changedFields: ["rights-ceiling"],
            }),
        }
    await ctx.db.insert("rightsUsage", {
        serverId,
        userId,
        right,
        at: now,
        expiresAt: now + RIGHTS_MAX_MINUTES * MINUTE,
    })
    return undefined
}

/** Whether what a reserved action relied on still stands right before the bot sends it, so turning rights off or suspending stops it */
export async function rightStillStands(
    ctx: Read,
    row: Pick<Doc<"moderationCases">, "serverId" | "actorId"> & {
        grant?: { viaRight?: BotRight; rightRoleIds?: string[] }
    },
) {
    const right = row.grant?.viaRight
    if (!right) return true
    if (!row.actorId || (await readSuspension(ctx, row.serverId, row.actorId))) return false
    const settings = publicRights(await readRights(ctx, row.serverId))
    return settings.enabled && holdingRoles(settings, right, row.grant?.rightRoleIds ?? []).length > 0
}
export type RightsVia = { right: BotRight; roleIds: readonly string[] }
