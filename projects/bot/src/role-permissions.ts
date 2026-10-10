import { hierarchy, Permissions, type Client, type ReactionEmojiInput } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { fixSentence, highestRole } from "./permission-fix.ts"

const safeRolePermissions = [6, 8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 21, 25, 26, 37]
    .reduce((bits, bit) => bits | (1n << BigInt(bit)), 0n)

export class RolePermissionError extends Data.TaggedError("RolePermissionError")<{
    readonly stage: "member" | "epoch" | "role" | "hierarchy" | "permissions" | "reaction"
    /** For stage role, the first requested role that cannot be used and why */
    readonly roleId?: string
    readonly reason?: "everyone" | "missing" | "bot-rank" | "actor-rank" | "privileged"
}> {}

/** The reply for a role a command cannot use, naming what to change */
export function rolePermissionFix(error: RolePermissionError) {
    if (error.stage === "permissions") return fixSentence({ permissions: ["ManageRoles"] })
    if (error.stage !== "role" || !error.roleId) return undefined
    const role = `<@&${error.roleId}>`
    switch (error.reason) {
        case "everyone": return "The everyone role cannot be assigned. Choose another role"
        case "missing": return "That role is not in this server. Choose a role from this server"
        case "bot-rank": return fixSentence({ roles: [error.roleId] })
        case "actor-rank": return `Your highest role must rank above ${role} to configure it`
        default: return `${role} has permissions beyond an ordinary member's, so NeonFlux does not assign it. Choose another role or remove those permissions from it`
    }
}

export function readRoleAuthority(client: Client, serverId: string, actorId: string, options: {
    targetId?: string
    roleIds?: readonly string[]
    configuration?: boolean
    channelId?: string
    allowBotTarget?: boolean
    readOnly?: boolean
    cached?: boolean
} = {}) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, {
            ...(options.targetId && options.targetId !== actorId ? { targetId: options.targetId } : {}),
            ...(options.channelId ? { channelId: options.channelId } : {}),
            cached: options.cached === true,
        })
        const observedTarget = options.targetId && options.targetId !== actorId ? authority.target : authority.actor
        const target = observedTarget?.userId === authority.botId ? { ...observedTarget, isBot: true } : observedTarget
        if (!target || authority.actor.isBot || authority.actor.userId === authority.botId || target.isBot && !options.allowBotTarget) {
            return yield* Effect.fail(new RolePermissionError({ stage: "member" }))
        }
        if (typeof target.joinedAt !== "string" || target.joinedAt.length > 64
            || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(target.joinedAt)
            || !Number.isFinite(Date.parse(target.joinedAt))) {
            return yield* Effect.fail(new RolePermissionError({ stage: "epoch" }))
        }
        return yield* Effect.try({
            try: () => {
                const { guild, roles, actor, bot } = authority
                const botBits = client.permissions.calculate({ guild, member: bot, roles })
                const botRank = highestRole(bot, roles)
                const actorRank = highestRole(actor, roles)
                // Role add/remove requires hierarchy over the role, independently of member rank
                const botAuthorized = (botBits & Permissions.ManageRoles) !== 0n
                const roleSnapshots = roles.map(role => ({
                    originServerId: guild.id, roleId: role.id, permissions: role.permissions.toString(),
                    botCanManage: botAuthorized && role.id !== serverId
                        && (bot.userId === guild.ownerId || !!botRank && hierarchy.isAbove(botRank, role)),
                    actorCanManage: role.id !== serverId
                        && (actor.userId === guild.ownerId || !!actorRank && hierarchy.isAbove(actorRank, role)),
                }))
                const eligibleRoleIds = roleSnapshots.filter(role => role.botCanManage
                    && (!options.configuration || role.actorCanManage)
                    && (BigInt(role.permissions) & ~safeRolePermissions) === 0n).map(role => role.roleId)
                if (!botAuthorized && (!options.readOnly || !!options.roleIds?.length)) throw new RolePermissionError({ stage: "permissions" })
                const refused = options.roleIds?.find(id => !eligibleRoleIds.includes(id))
                if (refused !== undefined) {
                    const snapshot = roleSnapshots.find(role => role.roleId === refused)
                    throw new RolePermissionError({ stage: "role", roleId: refused, reason: refused === serverId ? "everyone" : !snapshot ? "missing"
                        : !snapshot.botCanManage ? "bot-rank" : !snapshot.actorCanManage && options.configuration ? "actor-rank" : "privileged" })
                }
                return { ...authority, target, targetPresent: true, joinedAt: target.joinedAt, eligibleRoleIds, roleSnapshots,
                    botPermissionAuthorized: botAuthorized }
            },
            catch: error => error instanceof RolePermissionError ? error : new RolePermissionError({ stage: "hierarchy" }),
        })
    })
}

export function targetedReactionPresent(client: Client, message: { id: string, channelId: string }, emoji: ReactionEmojiInput, userId: string) {
    return Effect.gen(function* () {
        if (!/^[1-9]\d{0,18}$/.test(userId) || BigInt(userId) > 9223372036854775807n) {
            return yield* Effect.fail(new RolePermissionError({ stage: "reaction" }))
        }
        const page = yield* client.messages.fetchReactionUsers(message, emoji,
            { limit: 1, ...(userId !== "1" ? { after: (BigInt(userId) - 1n).toString() } : {}) }, { timeoutMs: 5000 })
            .pipe(Effect.timeout("5 seconds"), Effect.mapError(() => new RolePermissionError({ stage: "reaction" })))
        return page.items.length === 1 && page.items[0]?.id === userId
    })
}
