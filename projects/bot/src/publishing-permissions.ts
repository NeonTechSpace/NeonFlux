import { ChannelType, Permissions, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readSafetyAuthority } from "./safety-permissions.ts"

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
