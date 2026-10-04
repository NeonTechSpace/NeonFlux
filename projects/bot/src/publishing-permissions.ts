import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { levelingMember } from "./member-evidence.ts"

export class PublishingPermissionError extends Data.TaggedError("PublishingPermissionError")<{
    readonly stage: "administrator" | "destination" | "message"
    readonly field?: "message" | "channel" | "guild" | "author" | "webhook"
}> {}

export function readPublishingAuthority(client: Client, serverId: string, actorId: string, channelId?: string, hasEmbed = false, readOnly = false, allowManageServer = false) {
    return Effect.gen(function* () {
        const permission = Permissions.ViewChannel | (readOnly ? 0n : Permissions.SendMessages | (hasEmbed ? Permissions.EmbedLinks : 0n))
        const authority = yield* readSafetyAuthority(client, serverId, actorId, channelId ? { channelId, permission } : {})
        const now = yield* Clock.currentTimeMillis
        const manager = allowManageServer && (client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles }) & Permissions.ManageGuild) !== 0n
        // The bot acting as itself is server automation. Destination permission below still applies
        if (!authority.isOwner && !authority.isAdmin && !manager && actorId !== authority.botId) return yield* Effect.fail(new PublishingPermissionError({ stage: "administrator" }))
        if (channelId && (!authority.nativePermissionAuthorized || !authority.botPermissionAuthorized
            || !authority.channel || authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement
            || (!readOnly && authority.bot.communicationDisabledUntil !== undefined && authority.bot.communicationDisabledUntil !== null
                && Date.parse(authority.bot.communicationDisabledUntil) > now))) {
            return yield* Effect.fail(new PublishingPermissionError({ stage: "destination" }))
        }
        return authority
    })
}

export function verifyPublishingMessage(message: Message, expected: { serverId: string, channelId: string, messageId: string, botId: string,
    verifiedChannel: { id: string, guildId: string } }) {
    return Effect.gen(function* () {
        const field = message.id !== expected.messageId ? "message"
            : message.channelId !== expected.channelId || expected.verifiedChannel.id !== expected.channelId ? "channel"
            : expected.verifiedChannel.guildId !== expected.serverId || message.guildId !== undefined && message.guildId !== expected.serverId ? "guild"
            : message.author.id !== expected.botId ? "author"
            : message.webhookId ? "webhook" : undefined
        if (field) return yield* Effect.fail(new PublishingPermissionError({ stage: "message", field }))
        return message
    })
}

// Fresh actor, member and destination observations for features that publish through the composer
export class EventsPermissionError extends Data.TaggedError("EventsPermissionError")<{ readonly stage: "administrator" | "member" | "destination" }> {}
type EventsReadOptions = { staff?: boolean, write?: boolean, hasEmbed?: boolean, memberId?: string }
export function readEventsAuthority(client: Client, serverId: string, userId: string, channelId: string, options: EventsReadOptions = {}) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, userId, { channelId, permission: Permissions.ViewChannel,
            ...(options.memberId && options.memberId !== userId ? { targetId: options.memberId } : {}) })
        if (options.staff && !authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new EventsPermissionError({ stage: "administrator" }))
        const nativeMember = options.memberId && options.memberId !== userId ? authority.target : authority.actor
        const member = nativeMember ? levelingMember(nativeMember, serverId, options.memberId ?? userId) : undefined
        if (!member || !options.memberId && member.isBot || authority.actor.isBot || userId === authority.botId || member.timeoutUntil !== null && !Number.isFinite(Date.parse(member.timeoutUntil))) return yield* Effect.fail(new EventsPermissionError({ stage: "member" }))
        if (!authority.channel || authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
        const observedAt = yield* Clock.currentTimeMillis
        if (Date.parse(member.joinedAt) > observedAt) return yield* Effect.fail(new EventsPermissionError({ stage: "member" }))
        if (options.write && member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > observedAt) return yield* Effect.fail(new EventsPermissionError({ stage: "member" }))
        const bits = yield* Effect.try({ try: () => ({
            actor: client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, channel: authority.channel! }),
            bot: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, channel: authority.channel! }),
            member: client.permissions.calculate({ guild: authority.guild, member: nativeMember!, roles: authority.roles, channel: authority.channel! }),
        }), catch: () => new EventsPermissionError({ stage: "destination" }) })
        const required = Permissions.ViewChannel | (options.write ? Permissions.SendMessages | (options.hasEmbed ? Permissions.EmbedLinks : 0n) : 0n)
        const botTimeout = authority.bot.communicationDisabledUntil
        const context: C.SchedulesContext = { observedAt, actor: moderationActor(authority), channelId, botId: authority.botId,
            botAuthorized: (bits.bot & required) === required && botTimeout !== undefined && (botTimeout === null || Number.isFinite(Date.parse(botTimeout)) && Date.parse(botTimeout) <= observedAt),
            actorAuthorized: (bits.actor & required) === required,
            member: { ...member, canView: (bits.member & Permissions.ViewChannel) !== 0n, canReadHistory: (bits.member & Permissions.ReadMessageHistory) !== 0n } }
        if (options.write && (!context.botAuthorized || !context.actorAuthorized)) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
        return { context, authority }
    })
}
export const readEventsContext = (client: Client, serverId: string, userId: string, channelId: string, options: EventsReadOptions = {}) =>
    readEventsAuthority(client, serverId, userId, channelId, options).pipe(Effect.map(v => v.context))
