import {
    permissionBits,
    hierarchy,
    isThreadChannel,
    errors,
    Permissions,
    UserOperationError,
    type Client,
    type Guild,
    type GuildMember,
    type GuildRole,
    type GuildChannel,
    type User,
} from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { readNativeMember } from "./member-evidence.ts"
import { noticeThread, threadForgets } from "./thread-memory.ts"

export const nativeHumanAccount = (user: User | undefined) => !!user && !user.isBot && !user.isSystem
export const nativeBotAccount = (user: User | undefined) => !!user && user.isBot && !user.isSystem
/**
 * A fresh read of an account, the bot's own when userId is left out. Undefined means Fluxer answered with no valid account.
 * The SDK rejects bot and system flags that are not booleans, so isBot and isSystem are exact. Transport failures still fail
 */
export function readNativeAccount(client: Client, userId?: string) {
    return (
        userId === undefined
            ? client.users.fetchSelf({ timeoutMs: 5000 })
            : client.users.fetch(userId, { timeoutMs: 5000 })
    ).pipe(
        Effect.catch((error) =>
            error instanceof UserOperationError && error.status !== null
                ? Effect.succeed(undefined)
                : Effect.fail(error),
        ),
    )
}
type PermissionReadOperation = "self" | "guild" | "roles" | "actor" | "bot" | "channel" | "target"

export class SafetyPermissionError extends Data.TaggedError("SafetyPermissionError")<{
    readonly stage: "identity" | "permissions" | "target" | "channel" | "private-channel"
    readonly operation?: PermissionReadOperation
    /** Fluxer answered that what was read does not exist */
    readonly notFound?: boolean
    readonly status?: number
    readonly retryAfterMs?: number
}> {}

function permissionReadError(error: unknown, operation: PermissionReadOperation) {
    const native = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {}
    const status =
        typeof native.status === "number" &&
        Number.isInteger(native.status) &&
        native.status >= 100 &&
        native.status <= 599
            ? native.status
            : undefined
    const retryAfterMs = errors.retryAfterMs(error)
    return new SafetyPermissionError({
        stage: "permissions",
        operation,
        ...(errors.isNotFound(error) ? { notFound: true } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    })
}

/** The bot's own ID as the gateway's READY reported it. Startup work before the first READY reads it fresh */
export function readAuthenticatedBotId(client: Client) {
    return client.users
        .getSelf()
        .pipe(
            Effect.flatMap((self) =>
                self ? Effect.succeed(self.id) : client.users.fetchSelf().pipe(Effect.map((user) => user.id)),
            ),
        )
}

/** Whether a member is timed out at a moment. A timestamp the SDK cannot read counts as unknown, which callers treat as timed out (they test for "none") */
export function memberTimeout(client: Client, member: Pick<GuildMember, "communicationDisabledUntil">, now: number) {
    try {
        return client.members.timeoutState(member, { now: new Date(now) })
    } catch {
        return "unknown" as const
    }
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
export const postingPermissions =
    Permissions.SendMessages |
    Permissions.SendMessagesInThreads |
    Permissions.CreatePublicThreads |
    Permissions.CreatePrivateThreads
/** The posting bits the bot holds server-wide, as decimal. Fluxer lets a bot stop denying only permissions it holds, so a lock or close owns no other thread bit */
export const restorablePostingBits = (botServerPermissions: bigint) => String(botServerPermissions & postingPermissions)
/** Bits a lock or ticket grant owns. Lock, unlock, close and reopen grants carry them, and their execution refuses a grant without them */
export const ownedPostingBits = (grant: { readonly ownedPermissions?: string | undefined }) =>
    BigInt(grant.ownedPermissions ?? "0") & postingPermissions
/**
 * Fluxer lets a bot lift a denial only of permissions it holds in the channel, and a denial for everyone also takes
 * them from the bot. A lock or close therefore first allows the bot the bits it is about to deny, unless it is an
 * Administrator or already has them
 */
export function allowBotPosting(
    client: Client,
    channelId: string,
    botId: string,
    botServerPermissions: bigint,
    owned: bigint,
    own: { readonly allow: bigint; readonly deny: bigint } | undefined,
    options?: Parameters<Client["channels"]["setPermissionOverwrite"]>[2],
) {
    return permissionBits.has(botServerPermissions, "Administrator") || ((own?.allow ?? 0n) & owned) === owned
        ? Effect.void
        : client.channels.setPermissionOverwrite(
              channelId,
              { id: botId, type: "member", allow: (own?.allow ?? 0n) | owned, deny: (own?.deny ?? 0n) & ~owned },
              options,
          )
}

/** The channel fields of a permission calculation, with the parent channel a thread needs */
export const channelPermissionInput = (authority: {
    readonly channel?: GuildChannel | undefined
    readonly parentChannel?: GuildChannel | undefined
}) =>
    authority.channel
        ? { channel: authority.channel, ...(authority.parentChannel ? { parentChannel: authority.parentChannel } : {}) }
        : {}

export function readSafetyAuthority(
    client: Client,
    serverId: string,
    actorId: string,
    options: {
        permission?: bigint
        targetId?: string
        allowAbsentTarget?: boolean
        channelId?: string
        /** Evaluation reads the bot's cached copies and reads Fluxer only for what is missing. Actions leave it out and read everything */
        cached?: boolean
    } = {},
) {
    const read = <A, E, R>(operation: Effect.Effect<A, E, R>, name: PermissionReadOperation) =>
        operation.pipe(
            // Fluxerly's default 30-second deadline includes its rate-limit waits and the request
            Effect.timeout("30 seconds"),
            Effect.mapError((error) => permissionReadError(error, name)),
        )
    const cachedOr = <A, E, R>(cached: Effect.Effect<A | undefined>, fresh: Effect.Effect<A, E, R>) =>
        options.cached
            ? cached.pipe(Effect.flatMap((value) => (value === undefined ? fresh : Effect.succeed(value))))
            : fresh
    const evaluate = Effect.gen(function* () {
        const botId = yield* read(readAuthenticatedBotId(client), "self")
        const guild = yield* read(cachedOr(client.guilds.get(serverId), client.guilds.fetch(serverId)), "guild")
        let roles = yield* read(cachedOr(client.roles.getAll(serverId), client.roles.fetchAll(serverId)), "roles")
        const actor = yield* read(
            cachedOr(
                client.members.get({ guildId: serverId, userId: actorId }),
                client.members.fetch({ guildId: serverId, userId: actorId }),
            ),
            "actor",
        )
        // Protections act as the bot itself, so its member is read once
        const bot =
            actorId === botId
                ? actor
                : yield* read(
                      cachedOr(
                          client.members.getSelf(serverId),
                          client.members.fetch({ guildId: serverId, userId: botId }),
                      ),
                      "bot",
                  )
        if (
            guild.id !== serverId ||
            actor.guildId !== serverId ||
            actor.userId !== actorId ||
            bot.guildId !== serverId ||
            bot.userId !== botId ||
            roles.some((role) => role.guildId !== serverId)
        ) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "identity" }))
        }
        // A channel read enters the SDK's cache, so later handlers of the same message find the channel's parent without reading it again
        const readChannel = (id: string) => {
            const forgets = threadForgets(client)
            return read(
                cachedOr(client.channels.get(id), client.channels.fetch(id)).pipe(
                    Effect.tap((found) =>
                        Effect.sync(() => {
                            if (found.id === id && found.guildId === serverId) noticeThread(client, found, forgets)
                        }),
                    ),
                ),
                "channel",
            )
        }
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
        const target = options.targetId
            ? (yield* read(
                  readNativeMember(client, serverId, options.targetId, {
                      allowAbsent: options.allowAbsentTarget === true,
                      cached: options.cached === true,
                  }),
                  "target",
              )).member
            : undefined
        if (target && (target.guildId !== serverId || target.userId !== options.targetId)) {
            return yield* Effect.fail(new SafetyPermissionError({ stage: "target" }))
        }
        // A member holding a role the cached list lacks shows that the list missed a change
        if (
            options.cached &&
            [actor, bot, target].some((member) => member?.roleIds.some((id) => !roles.some((role) => role.id === id)))
        ) {
            roles = yield* read(client.roles.fetchAll(serverId), "roles")
        }
        return yield* Effect.try({
            try: (): SafetyAuthority => {
                const actorBits = client.permissions.calculate({
                    guild,
                    member: actor,
                    roles,
                    ...channelPermissionInput({ channel, parentChannel }),
                })
                const botBits = client.permissions.calculate({
                    guild,
                    member: bot,
                    roles,
                    ...channelPermissionInput({ channel, parentChannel }),
                })
                const targetBits = target ? client.permissions.calculate({ guild, member: target, roles }) : 0n
                const botServerPermissions = client.permissions.calculate({ guild, member: bot, roles })
                const targetProtected =
                    options.targetId !== undefined &&
                    (options.targetId === actorId ||
                        options.targetId === botId ||
                        options.targetId === guild.ownerId ||
                        permissionBits.has(targetBits, "Administrator"))
                return {
                    actorId,
                    roleIds: [...new Set([serverId, ...actor.roleIds])],
                    isOwner: guild.ownerId === actorId,
                    isAdmin: permissionBits.has(actorBits, "Administrator"),
                    nativePermissionAuthorized:
                        options.permission === undefined || (actorBits & options.permission) === options.permission,
                    botId,
                    botPermissionAuthorized:
                        options.permission === undefined || (botBits & options.permission) === options.permission,
                    actorCanManageTarget:
                        !targetProtected && (!target || hierarchy.canManage({ guild, actor, target, roles })),
                    botCanManageTarget:
                        !targetProtected && (!target || hierarchy.canManage({ guild, actor: bot, target, roles })),
                    targetProtected,
                    targetPresent: target !== undefined,
                    guild,
                    roles,
                    actor,
                    bot,
                    botServerPermissions,
                    ...(target ? { target } : {}),
                    ...(channel ? { channel } : {}),
                    ...(parentChannel ? { parentChannel } : {}),
                }
            },
            catch: () => new SafetyPermissionError({ stage: "permissions" }),
        })
    })
    return evaluate.pipe(
        Effect.catch((error) =>
            error instanceof SafetyPermissionError && error.retryAfterMs !== undefined && error.retryAfterMs <= 60000
                ? Effect.sleep(error.retryAfterMs).pipe(Effect.andThen(evaluate))
                : Effect.fail(error),
        ),
        Effect.mapError((error) =>
            error instanceof SafetyPermissionError ? error : new SafetyPermissionError({ stage: "permissions" }),
        ),
    )
}

/**
 * The roles that can view the channel an authority read, when only roles can: Each role other than the everyone role that views it held
 * alone beside the everyone role, leaving out Administrator roles, which may read every answer anyway. Holding several roles never shows a
 * channel that none of them shows alone. Undefined when the everyone role views it, a member overwrite lets someone other than the bot view
 * it, or its overwrites were not reported. The bot's own member overwrite is how NeonFlux enters a staff channel, so it is ignored. A role
 * the bot holds still counts, since Fluxer does not mark a role as the bot's own and members may hold it too. A thread follows its parent,
 * so a private thread in a public channel counts as public
 */
export function channelViewerRoles(
    authority: Pick<SafetyAuthority, "guild" | "roles" | "channel" | "parentChannel" | "botId">,
): string[] | undefined {
    const channel = authority.parentChannel ?? authority.channel
    if (!channel) return undefined
    const overwrites = "permissionOverwrites" in channel ? channel.permissionOverwrites : undefined
    if (overwrites === undefined) return undefined
    const base = authority.roles.find((role) => role.id === authority.guild.id)?.permissions ?? 0n
    const everyone = overwrites.find((item) => item.id === authority.guild.id && item.type === "role")
    const views = (role?: GuildRole) => {
        let bits = base | (role?.permissions ?? 0n)
        if (permissionBits.has(bits, "Administrator")) return true
        if (everyone) bits = (bits & ~everyone.deny) | everyone.allow
        const own = role && overwrites.find((item) => item.id === role.id && item.type === "role")
        if (own) bits = (bits & ~own.deny) | own.allow
        return (bits & Permissions.ViewChannel) === Permissions.ViewChannel
    }
    if (
        views() ||
        overwrites.some(
            (item) =>
                item.type === "member" &&
                item.id !== authority.botId &&
                (item.allow & Permissions.ViewChannel) === Permissions.ViewChannel,
        )
    )
        return undefined
    return authority.roles
        .filter(
            (role) =>
                role.id !== authority.guild.id && !permissionBits.has(role.permissions, "Administrator") && views(role),
        )
        .map((role) => role.id)
}

/**
 * The named channels, read fresh. Several are read from the server's channel list in one request, since one request per channel
 * would take minutes for a list of hundreds. A channel the list does not hold, such as a thread, or every channel when the list
 * cannot be read, is fetched alone. A caller still checks each channel's server
 */
export function readChannels(client: Client, serverId: string, ids: readonly string[]) {
    return Effect.gen(function* () {
        const listed =
            ids.length > 1
                ? yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 }).pipe(
                      Effect.map((channels) => new Map(channels.map((channel) => [channel.id, channel]))),
                      Effect.orElseSucceed(() => new Map<string, GuildChannel>()),
                  )
                : new Map<string, GuildChannel>()
        const channels: GuildChannel[] = []
        for (const id of ids) channels.push(listed.get(id) ?? (yield* client.channels.fetch(id, { timeoutMs: 5000 })))
        return channels
    })
}

export function verifyPrivateAuthor(client: Client, channelId: string, authorId: string) {
    return client.directMessages.fetch(channelId, { timeoutMs: 5000 }).pipe(
        Effect.flatMap((channel) =>
            channel.id === channelId &&
            channel.type === "dm" &&
            channel.recipients.some(
                (recipient) => recipient.id === authorId && !recipient.isBot && !recipient.isSystem,
            ) &&
            channel.recipients.every((recipient) => recipient.id === authorId || recipient.isBot)
                ? Effect.void
                : Effect.fail(new SafetyPermissionError({ stage: "private-channel" })),
        ),
        Effect.mapError(() => new SafetyPermissionError({ stage: "private-channel" })),
    )
}
