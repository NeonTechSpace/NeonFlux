import { permissionBits, format, hierarchy, type Client, type ReactionEmojiInput } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { SAFE_ROLE_PERMISSIONS } from "@neonflux/contracts/roles"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { fixSentence } from "./permission-fix.ts"

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
    const role = format.roleMention(error.roleId)
    switch (error.reason) {
        case "everyone":
            return "The everyone role cannot be assigned. Choose another role"
        case "missing":
            return "That role is not in this server. Choose a role from this server"
        case "bot-rank":
            return fixSentence({ roles: [error.roleId] })
        case "actor-rank":
            return `Your highest role must rank above ${role} to configure it`
        default:
            return `${role} has permissions beyond an ordinary member's, so NeonFlux does not assign it. Choose another role or remove those permissions from it`
    }
}

export function readRoleAuthority(
    client: Client,
    serverId: string,
    actorId: string,
    options: {
        targetId?: string
        roleIds?: readonly string[]
        configuration?: boolean
        channelId?: string
        allowBotTarget?: boolean
        readOnly?: boolean
        cached?: boolean
    } = {},
) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, {
            ...(options.targetId && options.targetId !== actorId ? { targetId: options.targetId } : {}),
            ...(options.channelId ? { channelId: options.channelId } : {}),
            cached: options.cached === true,
        })
        const observedTarget = options.targetId && options.targetId !== actorId ? authority.target : authority.actor
        const target = observedTarget?.userId === authority.botId ? { ...observedTarget, isBot: true } : observedTarget
        if (
            !target ||
            authority.actor.isBot ||
            authority.actor.userId === authority.botId ||
            (target.isBot && !options.allowBotTarget)
        ) {
            return yield* Effect.fail(new RolePermissionError({ stage: "member" }))
        }
        if (
            typeof target.joinedAt !== "string" ||
            target.joinedAt.length > 64 ||
            !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(target.joinedAt) ||
            !Number.isFinite(Date.parse(target.joinedAt))
        ) {
            return yield* Effect.fail(new RolePermissionError({ stage: "epoch" }))
        }
        return yield* Effect.try({
            try: () => {
                const { guild, roles, actor, bot } = authority
                const botBits = client.permissions.calculate({ guild, member: bot, roles })
                // Role add/remove requires hierarchy over the role, independently of member rank
                const botAuthorized = permissionBits.has(botBits, "ManageRoles")
                const roleSnapshots = roles.map((role) => ({
                    originServerId: guild.id,
                    roleId: role.id,
                    permissions: role.permissions.toString(),
                    botCanManage:
                        botAuthorized &&
                        role.id !== serverId &&
                        hierarchy.canManageRole({ guild, actor: bot, role, roles }),
                    actorCanManage: role.id !== serverId && hierarchy.canManageRole({ guild, actor, role, roles }),
                }))
                const eligibleRoleIds = roleSnapshots
                    .filter(
                        (role) =>
                            role.botCanManage &&
                            (!options.configuration || role.actorCanManage) &&
                            (BigInt(role.permissions) & ~SAFE_ROLE_PERMISSIONS) === 0n,
                    )
                    .map((role) => role.roleId)
                if (!botAuthorized && (!options.readOnly || !!options.roleIds?.length))
                    throw new RolePermissionError({ stage: "permissions" })
                const refused = options.roleIds?.find((id) => !eligibleRoleIds.includes(id))
                if (refused !== undefined) {
                    const snapshot = roleSnapshots.find((role) => role.roleId === refused)
                    throw new RolePermissionError({
                        stage: "role",
                        roleId: refused,
                        reason:
                            refused === serverId
                                ? "everyone"
                                : !snapshot
                                  ? "missing"
                                  : !snapshot.botCanManage
                                    ? "bot-rank"
                                    : !snapshot.actorCanManage && options.configuration
                                      ? "actor-rank"
                                      : "privileged",
                    })
                }
                return {
                    ...authority,
                    target,
                    targetPresent: true,
                    joinedAt: target.joinedAt,
                    eligibleRoleIds,
                    roleSnapshots,
                    botPermissionAuthorized: botAuthorized,
                }
            },
            catch: (error) =>
                error instanceof RolePermissionError ? error : new RolePermissionError({ stage: "hierarchy" }),
        })
    })
}

export const targetedReactionPresent = (
    client: Client,
    message: { id: string; channelId: string },
    emoji: ReactionEmojiInput,
    userId: string,
) =>
    client.messages
        .fetchHasReaction(message, emoji, userId, { timeoutMs: 5000 })
        .pipe(Effect.mapError(() => new RolePermissionError({ stage: "reaction" })))
