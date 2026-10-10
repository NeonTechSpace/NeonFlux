import { ChannelOperationError, ChannelType, hierarchy, Permissions, snowflakes, type Client, type GuildChannel, type GuildMember, type GuildRole, type PermissionOverwrite } from "@neontechspace/fluxerly/effect"
import type { RolesRoleSnapshot, TicketChannelSnapshot, TicketContext, TicketOverwrite } from "@neonflux/backend/contracts"
import { Clock, Data, Effect } from "effect"
import { readAuthenticatedBotId, readSafetyAuthority, restorablePostingBits } from "./safety-permissions.ts"

type TicketReadOperation = "authority" | "channel" | "parent" | "self" | "private-channel"
const readKinds = ["input", "busy", "notFound", "rejected", "network", "response", "timeout", "rateLimit", "unknown"] as const

export class TicketPermissionError extends Data.TaggedError("TicketPermissionError")<{
    readonly stage: "read" | "identity" | "member" | "epoch" | "channel" | "parent" | "overwrites" | "permissions" | "private-channel"
    readonly operation?: TicketReadOperation
    readonly kind?: typeof readKinds[number]
    readonly status?: number
}> {}

function read<A, E, R>(operation: Effect.Effect<A, E, R>, name: TicketReadOperation) {
    return operation.pipe(Effect.timeout("5 seconds"), Effect.mapError(error => {
        const native = error !== null && typeof error === "object" ? error as Record<string, unknown> : {}
        const kind = native._tag === "TimeoutError" ? "timeout" : readKinds.find(value => value === native.reason || value === native.kind) ?? "unknown"
        const status = typeof native.status === "number" && Number.isInteger(native.status) && native.status >= 100 && native.status <= 599 ? native.status : undefined
        return new TicketPermissionError({ stage: "read", operation: name, kind, ...(status !== undefined ? { status } : {}) })
    }))
}

function validId(value: string) { return snowflakes.isValid(value) && value !== "0" }
function validEpoch(value: string) {
    return value.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
}
function knownTimeout(value: string | null | undefined) { return value === null || typeof value === "string" && validEpoch(value) }
function inactiveTimeout(value: string | null | undefined, now: number) {
    return value === null || typeof value === "string" && validEpoch(value) && Date.parse(value) <= now
}

export function snapshotTicketOverwrites(channel: GuildChannel) {
    return Effect.try({
        try: () => {
            if (!Array.isArray(channel.permissionOverwrites)) throw new TicketPermissionError({ stage: "overwrites" })
            const ids = new Set<string>()
            const snapshot: TicketOverwrite[] = channel.permissionOverwrites.map(overwrite => {
                if (!validId(overwrite.id) || ids.has(overwrite.id) || overwrite.type !== "role" && overwrite.type !== "member"
                    || typeof overwrite.allow !== "bigint" || overwrite.allow < 0n || overwrite.allow > 18446744073709551615n
                    || typeof overwrite.deny !== "bigint" || overwrite.deny < 0n || overwrite.deny > 18446744073709551615n) {
                    throw new TicketPermissionError({ stage: "overwrites" })
                }
                ids.add(overwrite.id)
                return { id: overwrite.id, type: overwrite.type, allow: overwrite.allow.toString(), deny: overwrite.deny.toString() }
            })
            return snapshot.sort((a, b) => a.type === b.type ? BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0 : a.type < b.type ? -1 : 1)
        },
        catch: error => error instanceof TicketPermissionError ? error : new TicketPermissionError({ stage: "overwrites" }),
    })
}

export function nativeTicketOverwrites(snapshot: readonly TicketOverwrite[]) {
    return Effect.try({
        try: (): PermissionOverwrite[] => {
            const ids = new Set<string>()
            return snapshot.map(overwrite => {
                if (!validId(overwrite.id) || ids.has(overwrite.id) || overwrite.type !== "role" && overwrite.type !== "member"
                    || !/^(?:0|[1-9]\d{0,18})$/.test(overwrite.allow) || !/^(?:0|[1-9]\d{0,18})$/.test(overwrite.deny)
                    || BigInt(overwrite.allow) > 9223372036854775807n || BigInt(overwrite.deny) > 9223372036854775807n) {
                    throw new TicketPermissionError({ stage: "overwrites" })
                }
                ids.add(overwrite.id)
                return { id: overwrite.id, type: overwrite.type, allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) }
            })
        },
        catch: error => error instanceof TicketPermissionError ? error : new TicketPermissionError({ stage: "overwrites" }),
    })
}

export function snapshotTicketChannel(channel: GuildChannel) {
    return Effect.gen(function* () {
        if (!validId(channel.id) || !validId(channel.guildId) || channel.type !== ChannelType.Text
            || typeof channel.name !== "string" || channel.name.length < 1 || channel.name.length > 100
            || channel.parentId === undefined || channel.parentId !== null && !validId(channel.parentId)) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "channel" }))
        }
        const overwrites = yield* snapshotTicketOverwrites(channel)
        const snapshot: TicketChannelSnapshot = { originServerId: channel.guildId, channelId: channel.id, serverId: channel.guildId, type: "text",
            name: channel.name, parentId: channel.parentId, overwrites }
        return snapshot
    })
}

export function verifyTicketChannelIdentity(channel: GuildChannel, expected: { serverId: string, channelId?: string }) {
    return Effect.gen(function* () {
        if (!validId(channel.id) || !validId(expected.serverId) || channel.guildId !== expected.serverId || channel.type !== ChannelType.Text
            || expected.channelId !== undefined && channel.id !== expected.channelId) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "identity" }))
        }
        return { channelId: channel.id, serverId: channel.guildId }
    })
}

export function readTicketAuthority(client: Client, serverId: string, actorId: string, options: {
    channelId?: string
    parentId?: string
    allowAbsentChannel?: boolean
    actorPermission?: bigint
    botPermission?: bigint
    roleIds?: readonly string[]
} = {}) {
    return Effect.gen(function* () {
        if (!validId(serverId) || !validId(actorId) || options.channelId !== undefined && !validId(options.channelId)
            || options.parentId !== undefined && !validId(options.parentId)) return yield* Effect.fail(new TicketPermissionError({ stage: "identity" }))
        // The shared authority bounds each native read and refreshes volatile facts after its one supported provider cooldown
        const authority = yield* readSafetyAuthority(client, serverId, actorId).pipe(Effect.mapError(error => {
            return new TicketPermissionError({ stage: "read", operation: "authority", kind: error.kind ?? "unknown",
                ...(error.status !== undefined ? { status: error.status } : {}) })
        }))
        if (authority.actor.isBot || authority.actor.userId === authority.botId) return yield* Effect.fail(new TicketPermissionError({ stage: "member" }))
        if (!validEpoch(authority.actor.joinedAt)) return yield* Effect.fail(new TicketPermissionError({ stage: "epoch" }))
        if (!knownTimeout(authority.actor.communicationDisabledUntil)) return yield* Effect.fail(new TicketPermissionError({ stage: "member" }))
        const channel = options.channelId === undefined ? undefined : yield* read(client.channels.fetch(options.channelId).pipe(Effect.catch(error =>
            options.allowAbsentChannel && error instanceof ChannelOperationError && error.reason === "notFound" && error.status === 404
                ? Effect.succeed(undefined) : Effect.fail(error))), "channel")
        const observedAt = yield* Clock.currentTimeMillis
        if (channel && (channel.id !== options.channelId || channel.guildId !== serverId || channel.type !== ChannelType.Text)) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "channel" }))
        }
        if (options.channelId !== undefined && !channel && (options.actorPermission !== undefined || options.botPermission !== undefined)) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "permissions" }))
        }
        const parent = options.parentId === undefined ? undefined : yield* read(client.channels.fetch(options.parentId), "parent")
        if (parent && (parent.id !== options.parentId || parent.guildId !== serverId || parent.type !== ChannelType.Category)) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "parent" }))
        }
        const overwriteSnapshot = channel ? yield* snapshotTicketOverwrites(channel) : undefined
        const parentOverwriteSnapshot = parent ? yield* snapshotTicketOverwrites(parent) : undefined
        const channelSnapshot = channel ? yield* snapshotTicketChannel(channel) : undefined
        const permissions = yield* Effect.try({
            try: () => {
                const { guild, roles, actor, bot } = authority
                const actorGuildPermissions = client.permissions.calculate({ guild, roles, member: actor })
                const botGuildPermissions = client.permissions.calculate({ guild, roles, member: bot })
                const actorChannelPermissions = channel ? client.permissions.calculate({ guild, roles, member: actor, channel }) : undefined
                const botChannelPermissions = channel ? client.permissions.calculate({ guild, roles, member: bot, channel }) : undefined
                const actorParentPermissions = parent ? client.permissions.calculate({ guild, roles, member: actor, channel: parent }) : undefined
                const botParentPermissions = parent ? client.permissions.calculate({ guild, roles, member: bot, channel: parent }) : undefined
                return { actorGuildPermissions, botGuildPermissions, actorChannelPermissions, botChannelPermissions, actorParentPermissions, botParentPermissions }
            },
            catch: () => new TicketPermissionError({ stage: "permissions" }),
        })
        const actorBits = permissions.actorChannelPermissions ?? permissions.actorParentPermissions ?? permissions.actorGuildPermissions
        const botBits = permissions.botChannelPermissions ?? permissions.botParentPermissions ?? permissions.botGuildPermissions
        const now = yield* Clock.currentTimeMillis
        if (options.actorPermission !== undefined && (actorBits & options.actorPermission) !== options.actorPermission
            || options.botPermission !== undefined && ((botBits & options.botPermission) !== options.botPermission
                || !inactiveTimeout(authority.bot.communicationDisabledUntil, now))) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "permissions" }))
        }
        const highest = (member: GuildMember, roles: readonly GuildRole[]) => roles.filter(role => member.roleIds.includes(role.id))
            .reduce<GuildRole | undefined>((found, role) => !found || hierarchy.isAbove(role, found) ? role : found, undefined)
        const actorRank = highest(authority.actor, authority.roles)
        const botRank = highest(authority.bot, authority.roles)
        const roleSnapshots: RolesRoleSnapshot[] = authority.roles.map(role => ({ originServerId: authority.guild.id, roleId: role.id, permissions: role.permissions.toString(),
            actorCanManage: role.id !== serverId && (authority.isOwner || !!actorRank && hierarchy.isAbove(actorRank, role)),
            botCanManage: role.id !== serverId && (permissions.botGuildPermissions & Permissions.ManageRoles) !== 0n
                && (authority.botId === authority.guild.ownerId || !!botRank && hierarchy.isAbove(botRank, role)) }))
        if (options.roleIds?.some(id => id === serverId || !roleSnapshots.some(role => role.roleId === id))) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "permissions" }))
        }
        const context: TicketContext = { originServerId: authority.guild.id, observedAt, botId: authority.botId, botAuthorized: true,
            botPostingPermissions: restorablePostingBits(permissions.botGuildPermissions),
            actor: { originServerId: authority.actor.guildId, userId: actorId, roleIds: authority.roleIds, isOwner: authority.isOwner, isAdministrator: authority.isAdmin,
                nativePermissionAuthorized: options.actorPermission === undefined || (actorBits & options.actorPermission) === options.actorPermission,
                joinedAt: authority.actor.joinedAt, isBot: false, timeoutUntil: authority.actor.communicationDisabledUntil!,
                privateChannelVerified: false,
                canView: channel !== undefined && (actorBits & Permissions.ViewChannel) !== 0n,
                canReadHistory: channel !== undefined && (actorBits & (Permissions.ViewChannel | Permissions.ReadMessageHistory)) === (Permissions.ViewChannel | Permissions.ReadMessageHistory),
                canSend: channel !== undefined && (actorBits & (Permissions.ViewChannel | Permissions.SendMessages)) === (Permissions.ViewChannel | Permissions.SendMessages)
                    && inactiveTimeout(authority.actor.communicationDisabledUntil, now) },
            ...(parent ? { parentVerified: true } : {}), ...(channelSnapshot ? { channel: channelSnapshot } : {}) }
        // A typed absence is an observation only, never proof that this bot retired its channel
        return { ...authority, ...permissions, channel, parent, overwriteSnapshot, parentOverwriteSnapshot, observedAt, context, roleSnapshots,
            channelAbsent: options.channelId !== undefined && channel === undefined }
    })
}

export function verifyTicketPrivateAuthor(client: Client, channelId: string, actorId: string) {
    return Effect.gen(function* () {
        if (!validId(channelId) || !validId(actorId)) return yield* Effect.fail(new TicketPermissionError({ stage: "private-channel" }))
        const botId = yield* read(readAuthenticatedBotId(client), "self")
        const channel = yield* read(client.directMessages.fetch(channelId), "private-channel")
        if (actorId === botId || channel.id !== channelId || channel.type !== "dm"
            || !channel.recipients.some(recipient => recipient.id === actorId && !recipient.isBot && !recipient.isSystem)
            || channel.recipients.some(recipient => recipient.id !== actorId && recipient.id !== botId)
            || new Set(channel.recipients.map(recipient => recipient.id)).size !== channel.recipients.length) {
            return yield* Effect.fail(new TicketPermissionError({ stage: "private-channel" }))
        }
        return { botId, channel }
    })
}
