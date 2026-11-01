import {
    ChannelType,
    hierarchy,
    permissionBits,
    Permissions,
    type Client,
    type GuildChannel,
    type GuildRole,
} from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { nativeOutcome } from "./alerts-worker.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export class JailHandlingError extends Data.TaggedError("JailHandlingError")<{
    readonly stage: "permissions" | "role" | "channel"
}> {}
const options = { timeoutMs: 5000, auditReason: "NeonFlux jail" }
/** What the jail role is denied everywhere but its channel */
export const JAIL_DENIED = Permissions.ViewChannel | Permissions.SendMessages | Permissions.Connect
/** What the jailed member and staff hold in the jail channel */
export const JAIL_CHANNEL_ALLOWED = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory
const JAIL_ROLE_NAME = "Jailed",
    JAIL_CHANNEL_NAME = "jail"
/** A role carrying these would keep its power through the jail. A plain role gives nothing beyond what the everyone role gives */
const unsafeRole = (role: GuildRole) => role.permissions !== 0n

type Overwrite = NonNullable<GuildChannel["permissionOverwrites"]>[number]
const overwriteOf = (channel: GuildChannel, id: string): Overwrite | undefined =>
    channel.permissionOverwrites?.find((item) => item.id === id)
/** Whether a role may be the jail role: One NeonFlux outranks and that gives nothing itself */
export function jailRoleProblem(role: GuildRole | undefined, canManage: boolean) {
    if (!role) return "NeonFlux cannot see that role in this server. Check it and try again"
    if (!canManage) return "NeonFlux must rank above the jail role. Move NeonFlux's role above it, then try again"
    if (unsafeRole(role)) return "The jail role must carry no permissions of its own. Choose or create another"
    return undefined
}
const canManage = (role: GuildRole, guild: Parameters<typeof hierarchy.canManageRole>[0]) => {
    try {
        return hierarchy.canManageRole({ ...guild, role })
    } catch {
        return false
    }
}
/** Reads what NeonFlux may do here and whether a role is fit to be the jail role */
export function readJailRole(client: Client, serverId: string, roleId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const { guild, bot, roles } = yield* readSafetyAuthority(client, serverId, botId)
        const role = roles.find((item) => item.id === roleId)
        return jailRoleProblem(role, !!role && canManage(role, { guild, actor: bot, role, roles }))
    })
}
/**
 * The role and channel of a setup: The ones already set or named, or ones made now. A role or channel left by a setup whose outcome was unknown
 * is found by its name, so it is not made twice. undo deletes what this made, for when the backend does not record it
 */
export function prepareJailSetup(
    client: Client,
    serverId: string,
    current: { roleId: string | null; channelId: string | null },
    namedChannelId?: string,
) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, {
            permission: Permissions.ManageRoles | Permissions.ManageChannels,
        })
        if (!authority.botPermissionAuthorized) return yield* new JailHandlingError({ stage: "permissions" })
        const { guild, bot, roles } = authority
        const fit = (role: GuildRole) =>
            jailRoleProblem(role, canManage(role, { guild, actor: bot, role, roles })) === undefined
        const set = roles.find((role) => role.id === current.roleId)
        if (set && !fit(set)) return yield* new JailHandlingError({ stage: "role" })
        const found = set ?? roles.find((role) => role.name === JAIL_ROLE_NAME && fit(role))
        const made: Effect.Effect<unknown, unknown>[] = []
        const roleId =
            found?.id ??
            (yield* client.roles.create(serverId, { name: JAIL_ROLE_NAME, permissions: 0n }, options).pipe(
                Effect.tap((role) =>
                    Effect.sync(() => made.push(client.roles.delete({ guildId: serverId, id: role.id }, options))),
                ),
                Effect.map((role) => role.id),
            ))
        const channels = yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })
        const wanted = namedChannelId ?? current.channelId
        const inServer = channels.find((channel) => channel.id === wanted)
        if (namedChannelId && !inServer) return yield* new JailHandlingError({ stage: "channel" })
        const channelId =
            inServer?.id ??
            channels.find((channel) => channel.name === JAIL_CHANNEL_NAME && channel.type === ChannelType.Text)?.id ??
            (yield* client.channels
                .create(
                    serverId,
                    {
                        type: ChannelType.Text,
                        name: JAIL_CHANNEL_NAME,
                        // Nobody but NeonFlux sees it until the pass lets the jail role and staff in
                        permissionOverwrites: [
                            { id: serverId, type: "role", allow: 0n, deny: Permissions.ViewChannel },
                            { id: botId, type: "member", allow: JAIL_CHANNEL_ALLOWED, deny: 0n },
                        ],
                    },
                    options,
                )
                .pipe(
                    Effect.tap((channel) => Effect.sync(() => made.push(client.channels.delete(channel.id, options)))),
                    Effect.map((channel) => channel.id),
                ))
        return {
            roleId,
            channelId,
            undo: Effect.forEach(made, (undo) => Effect.ignore(undo), { discard: true }),
        }
    })
}

const holds = (current: Overwrite | undefined, allow: bigint, deny: bigint) =>
    current !== undefined &&
    (current.allow & allow) === allow &&
    (current.deny & deny) === deny &&
    (current.allow & deny) === 0n &&
    (current.deny & allow) === 0n
export const deniesJailRole = (channel: GuildChannel, roleId: string) =>
    holds(overwriteOf(channel, roleId), 0n, JAIL_DENIED)
/**
 * A channel the everyone role cannot view needs no denial, since a jailed member holds nothing else that opens it. Leaving it alone also keeps
 * a private ticket's exact overwrites, which its lifecycle compares
 */
export const closedToEveryone = (channel: GuildChannel, serverId: string) =>
    ((overwriteOf(channel, serverId)?.deny ?? 0n) & Permissions.ViewChannel) !== 0n
/** The role's denial on one channel, written only when a fresh read shows it is missing. Other bits stay as they are */
export function denyJailRole(client: Client, channel: GuildChannel, roleId: string) {
    const current = overwriteOf(channel, roleId)
    if (deniesJailRole(channel, roleId)) return Effect.succeed("unchanged" as const)
    return nativeOutcome(
        client.channels.setPermissionOverwrite(
            channel.id,
            {
                id: roleId,
                type: "role",
                allow: (current?.allow ?? 0n) & ~JAIL_DENIED,
                deny: (current?.deny ?? 0n) | JAIL_DENIED,
            },
            options,
        ),
    )
}
/**
 * What the jail channel needs, each written only when a fresh read shows it is missing: NeonFlux itself first, since it hides the channel
 * from everyone next, then the jail role and staff, then the everyone role's denial of the view
 */
export function openJailChannel(
    client: Client,
    channel: GuildChannel,
    serverId: string,
    roleId: string,
    staffRoleIds: readonly string[],
    botId: string,
    botServerPermissions: bigint,
) {
    return Effect.gen(function* () {
        const writes: { id: string; type: "role" | "member"; allow: bigint; deny: bigint }[] = []
        const own = overwriteOf(channel, botId)
        if (!permissionBits.has(botServerPermissions, "Administrator") && !holds(own, JAIL_CHANNEL_ALLOWED, 0n))
            writes.push({
                id: botId,
                type: "member",
                allow: (own?.allow ?? 0n) | JAIL_CHANNEL_ALLOWED,
                deny: (own?.deny ?? 0n) & ~JAIL_CHANNEL_ALLOWED,
            })
        for (const id of [roleId, ...staffRoleIds]) {
            const current = overwriteOf(channel, id)
            if (!holds(current, JAIL_CHANNEL_ALLOWED, 0n))
                writes.push({
                    id,
                    type: "role",
                    allow: (current?.allow ?? 0n) | JAIL_CHANNEL_ALLOWED,
                    deny: (current?.deny ?? 0n) & ~JAIL_CHANNEL_ALLOWED,
                })
        }
        const everyone = overwriteOf(channel, serverId)
        if (!holds(everyone, 0n, Permissions.ViewChannel))
            writes.push({
                id: serverId,
                type: "role",
                allow: (everyone?.allow ?? 0n) & ~Permissions.ViewChannel,
                deny: (everyone?.deny ?? 0n) | Permissions.ViewChannel,
            })
        if (!writes.length) return "unchanged" as const
        return yield* nativeOutcome(
            Effect.forEach(writes, (write) => client.channels.setPermissionOverwrite(channel.id, write, options), {
                discard: true,
            }),
        )
    })
}
