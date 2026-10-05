import { ChannelType, Permissions, snowflakes, type Client, type DirectMessageChannel, type Message } from "@neontechspace/fluxerly/effect"
import type { GreetingsMemberContext } from "@neonflux/backend/contracts"
import { Clock, Data, Effect } from "effect"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { readNativeMember } from "./member-evidence.ts"

type ReadOperation = "self" | "guild" | "bot" | "member" | "roles" | "channel"
const readKinds = ["input", "busy", "notFound", "rejected", "network", "response", "timeout", "rateLimit", "unknown"] as const

export class WelcomePermissionError extends Data.TaggedError("WelcomePermissionError")<{
    readonly stage: "read" | "identity" | "member" | "epoch" | "destination" | "private-channel" | "message"
    readonly operation?: ReadOperation
    readonly kind?: typeof readKinds[number]
    readonly status?: number
}> {}

function read<A, E, R>(operation: Effect.Effect<A, E, R>, name: ReadOperation) {
    return operation.pipe(Effect.timeout("5 seconds"), Effect.mapError(error => {
        const native = error !== null && typeof error === "object" ? error as Record<string, unknown> : {}
        const kind = native._tag === "TimeoutError" ? "timeout" : readKinds.find(value => value === native.reason) ?? "unknown"
        const status = typeof native.status === "number" && Number.isInteger(native.status) && native.status >= 100 && native.status <= 599 ? native.status : undefined
        return new WelcomePermissionError({ stage: "read", operation: name, kind, ...(status !== undefined ? { status } : {}) })
    }))
}

function validId(value: string) { return snowflakes.isValid(value) && value !== "0" }
function validEpoch(value: string) {
    return value.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
}
function knownTimeout(value: string | null | undefined) { return value === null || typeof value === "string" && validEpoch(value) }

export function readWelcomeMember(client: Client, serverId: string, userId: string, options: { expectedJoinedAt?: string, allowAbsent?: boolean } = {}) {
    return Effect.gen(function* () {
        if (!validId(serverId) || !validId(userId)) return yield* Effect.fail(new WelcomePermissionError({ stage: "identity" }))
        const botId = yield* read(readAuthenticatedBotId(client), "self")
        const guild = yield* read(client.guilds.fetch(serverId), "guild")
        const bot = yield* read(client.members.fetch({ guildId: serverId, userId: botId }), "bot")
        if (guild.id !== serverId || bot.guildId !== serverId || bot.userId !== botId || userId === botId) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "identity" }))
        }
        const evidence = yield* read(readNativeMember(client, serverId, userId, { allowAbsent: options.allowAbsent === true }), "member")
        const member = evidence.member
        const observedAt = yield* Clock.currentTimeMillis
        if (!knownTimeout(bot.communicationDisabledUntil) || bot.communicationDisabledUntil !== null && Date.parse(bot.communicationDisabledUntil!) > observedAt) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "destination" }))
        }
        if (!member) return { botId, guild, bot, observedAt, memberOriginServerId: evidence.originServerId, memberUserId: evidence.userId, memberAbsent: true, context: null }
        if (member.guildId !== serverId || member.userId !== userId || member.isBot) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "member" }))
        }
        if (!validEpoch(member.joinedAt) || options.expectedJoinedAt !== undefined && member.joinedAt !== options.expectedJoinedAt) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "epoch" }))
        }
        if (!knownTimeout(member.communicationDisabledUntil)) return yield* Effect.fail(new WelcomePermissionError({ stage: "member" }))
        const context: GreetingsMemberContext = { originServerId: member.guildId, userId, userName: member.username, serverName: guild.name, joinedAt: member.joinedAt,
            isBot: false, roleIds: [...member.roleIds], timeoutUntil: member.communicationDisabledUntil! }
        return { botId, guild, bot, observedAt, member, memberOriginServerId: evidence.originServerId, memberUserId: evidence.userId, memberAbsent: false, context }
    })
}

export function readWelcomeDestination(client: Client, serverId: string, channelId: string, hasEmbed = false) {
    return Effect.gen(function* () {
        if (!validId(serverId) || !validId(channelId)) return yield* Effect.fail(new WelcomePermissionError({ stage: "identity" }))
        const botId = yield* read(readAuthenticatedBotId(client), "self")
        const guild = yield* read(client.guilds.fetch(serverId), "guild")
        const bot = yield* read(client.members.fetch({ guildId: serverId, userId: botId }), "bot")
        const roles = yield* read(client.roles.fetchAll(serverId), "roles")
        const channel = yield* read(client.channels.fetch(channelId), "channel")
        if (guild.id !== serverId || bot.guildId !== serverId || bot.userId !== botId || roles.some(role => role.guildId !== serverId)
            || channel.id !== channelId || channel.guildId !== serverId) return yield* Effect.fail(new WelcomePermissionError({ stage: "identity" }))
        const now = yield* Clock.currentTimeMillis
        if (channel.type !== ChannelType.Text && channel.type !== ChannelType.Announcement
            || !knownTimeout(bot.communicationDisabledUntil) || bot.communicationDisabledUntil !== null && Date.parse(bot.communicationDisabledUntil!) > now) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "destination" }))
        }
        const permission = Permissions.ViewChannel | Permissions.SendMessages | (hasEmbed ? Permissions.EmbedLinks : 0n)
        const bits = yield* Effect.try({ try: () => client.permissions.calculate({ guild, member: bot, roles, channel }),
            catch: () => new WelcomePermissionError({ stage: "destination" }) })
        if ((bits & permission) !== permission) return yield* Effect.fail(new WelcomePermissionError({ stage: "destination" }))
        return { botId, guild, bot, roles, channel, observedAt: now, botAuthorized: true as const }
    })
}

export function verifyWelcomePrivateChannel(channel: DirectMessageChannel, userId: string, botId: string) {
    return Effect.gen(function* () {
        if (!validId(channel.id) || !validId(userId) || !validId(botId) || userId === botId || channel.type !== "dm"
            || !channel.recipients.some(recipient => recipient.id === userId && !recipient.isBot && !recipient.isSystem)
            || channel.recipients.some(recipient => recipient.id !== userId && recipient.id !== botId)
            || new Set(channel.recipients.map(recipient => recipient.id)).size !== channel.recipients.length) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "private-channel" }))
        }
        return channel
    })
}

export function verifyWelcomeMessage(message: Message, expected: { botId: string, channelId: string, messageId?: string, serverId?: string,
    verifiedChannel?: { id: string, guildId: string } }) {
    return Effect.gen(function* () {
        const guildMatches = expected.serverId === undefined ? message.guildId === undefined
            : expected.verifiedChannel?.id === expected.channelId && expected.verifiedChannel.guildId === expected.serverId
                && (message.guildId === undefined || message.guildId === expected.serverId)
        if (!validId(message.id) || !validId(expected.botId) || !validId(expected.channelId)
            || expected.messageId !== undefined && message.id !== expected.messageId || message.channelId !== expected.channelId
            || !guildMatches || message.author.id !== expected.botId || message.webhookId) {
            return yield* Effect.fail(new WelcomePermissionError({ stage: "message" }))
        }
        return message
    })
}
