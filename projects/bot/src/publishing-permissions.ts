import type { SchedulesContext } from "@neonflux/contracts/schedules"
import { ChannelType, Permissions, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { channelPermissionInput, memberTimeout, readSafetyAuthority } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { memberFacts } from "./member-evidence.ts"

export class PublishingPermissionError extends Data.TaggedError("PublishingPermissionError")<{
    readonly stage: "administrator" | "destination" | "message"
}> {}

export function readPublishingAuthority(
    client: Client,
    serverId: string,
    actorId: string,
    channelId?: string,
    hasEmbed = false,
    readOnly = false,
) {
    return Effect.gen(function* () {
        const permission =
            Permissions.ViewChannel |
            (readOnly ? 0n : Permissions.SendMessages | (hasEmbed ? Permissions.EmbedLinks : 0n))
        const authority = yield* readSafetyAuthority(
            client,
            serverId,
            actorId,
            channelId ? { channelId, permission } : {},
        )
        const now = yield* Clock.currentTimeMillis
        // The bot acting as itself is server automation. Destination permission below still applies
        if (!authority.isOwner && !authority.isAdmin && actorId !== authority.botId)
            return yield* Effect.fail(new PublishingPermissionError({ stage: "administrator" }))
        if (
            channelId &&
            (!authority.nativePermissionAuthorized ||
                !authority.botPermissionAuthorized ||
                !authority.channel ||
                (authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement) ||
                // A fresh member read always states the timeout, so a missing one is unknown and counts as timed out
                (!readOnly && memberTimeout(client, authority.bot, now) !== "none"))
        ) {
            return yield* Effect.fail(new PublishingPermissionError({ stage: "destination" }))
        }
        return authority
    })
}

export function verifyPublishingMessage(
    message: Message,
    expected: {
        serverId: string
        channelId: string
        messageId: string
        botId: string
        verifiedChannel: { id: string; guildId: string }
    },
) {
    return Effect.gen(function* () {
        if (
            message.id !== expected.messageId ||
            message.channelId !== expected.channelId ||
            expected.verifiedChannel.id !== expected.channelId ||
            expected.verifiedChannel.guildId !== expected.serverId ||
            (message.guildId !== undefined && message.guildId !== expected.serverId) ||
            message.author.id !== expected.botId ||
            message.webhookId
        )
            return yield* Effect.fail(new PublishingPermissionError({ stage: "message" }))
        return message
    })
}

// Fresh actor, member and destination observations for features that publish through the composer
class ComposerPermissionError extends Data.TaggedError("ComposerPermissionError")<{
    readonly stage: "administrator" | "member" | "destination"
}> {}
export function readComposerAuthority(client: Client, serverId: string, userId: string, channelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, userId, {
            channelId,
            permission: Permissions.ViewChannel,
        })
        if (!authority.isOwner && !authority.isAdmin)
            return yield* Effect.fail(new ComposerPermissionError({ stage: "administrator" }))
        const member = memberFacts(authority.actor, serverId, userId)
        if (
            !member ||
            member.isBot ||
            authority.actor.isBot ||
            userId === authority.botId ||
            (member.timeoutUntil !== null && !Number.isFinite(Date.parse(member.timeoutUntil)))
        )
            return yield* Effect.fail(new ComposerPermissionError({ stage: "member" }))
        if (
            !authority.channel ||
            (authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement)
        )
            return yield* Effect.fail(new ComposerPermissionError({ stage: "destination" }))
        const observedAt = yield* Clock.currentTimeMillis
        if (Date.parse(member.joinedAt) > observedAt)
            return yield* Effect.fail(new ComposerPermissionError({ stage: "member" }))
        const bits = yield* Effect.try({
            try: () => ({
                actor: client.permissions.calculate({
                    guild: authority.guild,
                    member: authority.actor,
                    roles: authority.roles,
                    ...channelPermissionInput(authority),
                }),
                bot: client.permissions.calculate({
                    guild: authority.guild,
                    member: authority.bot,
                    roles: authority.roles,
                    ...channelPermissionInput(authority),
                }),
            }),
            catch: () => new ComposerPermissionError({ stage: "destination" }),
        })
        const required = Permissions.ViewChannel
        const botTimeout = authority.bot.communicationDisabledUntil
        const context: SchedulesContext = {
            originServerId: authority.guild.id,
            observedAt,
            actor: moderationActor(authority),
            channelId,
            botId: authority.botId,
            botAuthorized:
                (bits.bot & required) === required &&
                botTimeout !== undefined &&
                (botTimeout === null ||
                    (Number.isFinite(Date.parse(botTimeout)) && Date.parse(botTimeout) <= observedAt)),
            actorAuthorized: (bits.actor & required) === required,
            member,
        }
        return { context, authority }
    })
}
