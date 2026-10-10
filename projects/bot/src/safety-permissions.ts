import { hierarchy, isThreadChannel, Permissions, type Client, type Guild, type GuildMember, type GuildRole, type GuildChannel } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { fluxerlyNext } from "./fluxerly-next.ts"
import { readNativeMember } from "./member-evidence.ts"

const permissionReadKinds = ["input", "busy", "notFound", "rejected", "network", "response", "timeout", "rateLimit", "unknown"] as const
const permissionReadClasses = ["UserOperationError", "GuildOperationError", "ChannelOperationError", "ClientClosedError", "RateLimitError", "TimeoutException", "TimeoutError", "Unknown"] as const
// Partial and full users omit these boolean flags when false: https://docs.fluxer.app/http-api/users/#partial-user-object
export const nativeHumanAccount = (value: Record<string, unknown> | undefined) => !!value
    && (value.bot === undefined || value.bot === false) && (value.system === undefined || value.system === false)
type PermissionReadOperation = "self" | "guild" | "roles" | "actor" | "bot" | "channel" | "target"

export class SafetyPermissionError extends Data.TaggedError("SafetyPermissionError")<{
    readonly stage: "identity" | "permissions" | "target" | "channel" | "private-channel"
    readonly operation?: PermissionReadOperation
    readonly kind?: typeof permissionReadKinds[number]
    readonly failureClass?: typeof permissionReadClasses[number]
    readonly status?: number
    readonly retryAfterMs?: number
}> {}

function permissionReadError(error: unknown, operation: PermissionReadOperation) {
    const native = error !== null && typeof error === "object" ? error as Record<string, unknown> : {}
    const failureClass = permissionReadClasses.find((value) => value === native._tag) ?? "Unknown"
    const kind = failureClass === "TimeoutException" || failureClass === "TimeoutError" ? "timeout" : failureClass === "RateLimitError" ? "rateLimit" : permissionReadKinds.find((value) => value === native.reason) ?? "unknown"
    const status = typeof native.status === "number" && Number.isInteger(native.status) && native.status >= 100 && native.status <= 599 ? native.status : undefined
    const retryAfterMs = kind === "rateLimit" && status === 429 && typeof native.retryAfterMs === "number"
        && Number.isFinite(native.retryAfterMs) && native.retryAfterMs >= 0 ? native.retryAfterMs : undefined
    return new SafetyPermissionError({ stage: "permissions", operation, kind, failureClass, ...(status !== undefined ? { status } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) })
}

/** The bot's own ID as the gateway's READY reported it. Startup work before the first READY reads it fresh */
export function readAuthenticatedBotId(client: Client) {
    return client.users.getSelf().pipe(Effect.flatMap(self => self ? Effect.succeed(self.id)
        : client.users.fetchSelf().pipe(Effect.map(user => user.id))))
}

export type SafetyAuthority = {
    actorId: string
    roleIds: string[]
    isOwner: boolean
    isAdmin: boolean
    nativePermissionAuthorized: boolean
    botId: string
    botPermissionAuthorized: boolean
    actorCanManageTarget: boolean
    botCanManageTarget: boolean
    targetProtected: boolean
    targetPresent: boolean
    guild: Guild
    roles: readonly GuildRole[]
    actor: GuildMember
    bot: GuildMember
    target?: GuildMember
    channel?: GuildChannel
    /** The channel a thread takes its permissions from */
    parentChannel?: GuildChannel
    /** The bot's server-wide permissions, without channel overwrites */
    botServerPermissions: bigint
}

/** Everything that posts in a channel or its threads. Locks and closed tickets deny these bits */
export const postingPermissions = Permissions.SendMessages | Permissions.SendMessagesInThreads | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads
/** The posting bits the bot holds server-wide, as decimal. Fluxer lets a bot stop denying only permissions it holds, so a lock or close owns no other thread bit */
export const restorablePostingBits = (botServerPermissions: bigint) => String(botServerPermissions & postingPermissions)
/** Bits a lock or ticket grant owns. Grants for records written before thread support own only SendMessages */
export const ownedPostingBits = (grant: { readonly ownedPermissions?: string | undefined }) =>
    grant.ownedPermissions === undefined ? Permissions.SendMessages : BigInt(grant.ownedPermissions) & postingPermissions
/** A grant may own SendMessages and the thread bits beside it, never other permissions */
export const validOwnedPostingBits = (value: string) => (BigInt(value) & ~postingPermissions) === 0n && (BigInt(value) & Permissions.SendMessages) !== 0n

/** The channel fields of a permission calculation, with the parent channel a thread needs */
export const channelPermissionInput = (authority: { readonly channel?: GuildChannel | undefined, readonly parentChannel?: GuildChannel | undefined }) => authority.channel
    ? { channel: authority.channel, ...(authority.parentChannel ? { parentChannel: authority.parentChannel } : {}) } : {}

export function readSafetyAuthority(client: Client, serverId: string, actorId: string, options: {
    permission?: bigint
    targetId?: string
    allowAbsentTarget?: boolean
    channelId?: string
    /** Evaluation reads the bot's cached copies and reads Fluxer only for what is missing. Actions leave it out and read everything */
    cached?: boolean
} = {}) {
    const local = fluxerlyNext(client)
    const read = <A, E, R>(operation: Effect.Effect<A, E, R>, name: PermissionReadOperation) => operation.pipe(
        Effect.timeout("5 seconds"), Effect.mapError((error) => permissionReadError(error, name)),
    )
    const cachedOr = <A, E, R>(cached: Effect.Effect<A | undefined>, fresh: Effect.Effect<A, E, R>) => options.cached
        ? cached.pipe(Effect.flatMap((value) => value === undefined ? fresh : Effect.succeed(value))) : fresh
    const evaluate = Effect.gen(function* () {
        const botId = yield* read(readAuthenticatedBotId(client), "self")
        const guild = yield* read(cachedOr(client.guilds.get(serverId), client.guilds.fetch(serverId)), "guild")
        let roles = yield* read(cachedOr(local.roles.getAll(serverId), local.roles.fetchAll(serverId)), "roles")
        const actor = yield* read(cachedOr(client.members.get({ guildId: serverId, userId: actorId }), client.members.fetch({ guildId: serverId, userId: actorId })), "actor")
        // Protections act as the bot itself, so its member is read once
        const bot = actorId === botId ? actor : yield* read(cachedOr(local.members.getSelf(serverId), client.members.fetch({ guildId: serverId, userId: botId })), "bot")
        if (guild.id !== serverId || actor.guildId !== serverId || actor.userId !== actorId
            || bot.guildId !== serverId || bot.userId !== botId || roles.some((role) => role.guildId !== serverId)) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "identity" }))
        }
        // A channel read is kept, so later handlers of the same message find the channel's parent without reading it again
        const readChannel = (id: string) => read(cachedOr(local.channels.get(id), local.channels.fetch(id)), "channel")
        const channel = options.channelId ? yield* readChannel(options.channelId) : undefined
        if (channel && (channel.id !== options.channelId || channel.guildId !== serverId)) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "channel" }))
        }
        // A thread has no overwrites and takes its permissions from its parent channel
        const parentId = channel && isThreadChannel(channel) ? channel.parentId : undefined
        const parentChannel = parentId ? yield* readChannel(parentId) : undefined
        if (parentChannel && (parentChannel.id !== parentId || parentChannel.guildId !== serverId)) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "channel" }))
        }
        const target = options.targetId ? (yield* read(readNativeMember(client, serverId, options.targetId,
            { allowAbsent: options.allowAbsentTarget === true, cached: options.cached === true }), "target")).member : undefined
        if (target && (target.guildId !== serverId || target.userId !== options.targetId)) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "target" }))
        }
        // A member holding a role the cached list lacks shows that the list missed a change
        if (options.cached && [actor, bot, target].some((member) => member?.roleIds.some((id) => !roles.some((role) => role.id === id)))) {
            roles = yield* read(local.roles.fetchAll(serverId), "roles")
        }
        return yield* Effect.try({
            try: (): SafetyAuthority => {
                const actorBits = client.permissions.calculate({ guild, member: actor, roles, ...channelPermissionInput({ channel, parentChannel }) })
                const botBits = client.permissions.calculate({ guild, member: bot, roles, ...channelPermissionInput({ channel, parentChannel }) })
                const targetBits = target ? client.permissions.calculate({ guild, member: target, roles }) : 0n
                const botServerPermissions = client.permissions.calculate({ guild, member: bot, roles })
                const targetProtected = options.targetId !== undefined && (options.targetId === actorId || options.targetId === botId
                    || options.targetId === guild.ownerId || (targetBits & Permissions.Administrator) !== 0n)
                return {
                    actorId, roleIds: [...new Set([serverId, ...actor.roleIds])], isOwner: guild.ownerId === actorId,
                    isAdmin: (actorBits & Permissions.Administrator) !== 0n,
                    nativePermissionAuthorized: options.permission === undefined || (actorBits & options.permission) === options.permission,
                    botId, botPermissionAuthorized: options.permission === undefined || (botBits & options.permission) === options.permission,
                    actorCanManageTarget: !targetProtected && (!target || hierarchy.canManage({ guild, actor, target, roles })),
                    botCanManageTarget: !targetProtected && (!target || hierarchy.canManage({ guild, actor: bot, target, roles })),
                    targetProtected, targetPresent: target !== undefined, guild, roles, actor, bot, botServerPermissions,
                    ...(target ? { target } : {}), ...(channel ? { channel } : {}), ...(parentChannel ? { parentChannel } : {}),
                }
            },
            catch: () => new SafetyPermissionError({ stage: "permissions" }),
        })
    })
    return evaluate.pipe(
        Effect.catch((error) => error instanceof SafetyPermissionError && error.kind === "rateLimit" && error.status === 429
            && error.retryAfterMs !== undefined && error.retryAfterMs <= 60000
            ? Effect.sleep(error.retryAfterMs).pipe(Effect.andThen(evaluate)) : Effect.fail(error)),
        Effect.mapError((error) => error instanceof SafetyPermissionError ? error : new SafetyPermissionError({ stage: "permissions" })),
    )
}

export function verifyPrivateAuthor(client: Client, channelId: string, authorId: string) {
    return client.directMessages.fetch(channelId, { timeoutMs: 5000 }).pipe(
        Effect.flatMap((channel) => channel.id === channelId && channel.type === "dm"
            && channel.recipients.some((recipient) => recipient.id === authorId && !recipient.isBot && !recipient.isSystem)
            && channel.recipients.every((recipient) => recipient.id === authorId || recipient.isBot)
            ? Effect.void : Effect.fail(new SafetyPermissionError({ stage: "private-channel" }))),
        Effect.mapError(() => new SafetyPermissionError({ stage: "private-channel" })),
    )
}
