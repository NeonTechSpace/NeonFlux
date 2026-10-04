import type { SchedulesAutomationContext, SchedulesContext } from "@neonflux/contracts/schedules"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { levelingMember } from "./member-evidence.ts"
import { moderationActor } from "./moderation.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export class SchedulesPermissionError extends Data.TaggedError("SchedulesPermissionError")<{ readonly stage: "administrator" | "member" | "destination" }> {}
// Fresh actor, member and destination observations for the staff member who runs a schedule command
export function readSchedulesContext(client: Client, serverId: string, userId: string, channelId: string, write = false, hasEmbed = false) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, userId, { channelId, permission: Permissions.ViewChannel })
        if (!authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new SchedulesPermissionError({ stage: "administrator" }))
        const member = levelingMember(authority.actor, serverId, userId)
        if (!member || member.isBot || userId === authority.botId || member.timeoutUntil !== null && !Number.isFinite(Date.parse(member.timeoutUntil))) return yield* Effect.fail(new SchedulesPermissionError({ stage: "member" }))
        if (!authority.channel || authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement) return yield* Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
        const observedAt = yield* Clock.currentTimeMillis
        if (Date.parse(member.joinedAt) > observedAt) return yield* Effect.fail(new SchedulesPermissionError({ stage: "member" }))
        if (write && member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > observedAt) return yield* Effect.fail(new SchedulesPermissionError({ stage: "member" }))
        const bits = yield* Effect.try({ try: () => ({
            actor: client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, channel: authority.channel! }),
            bot: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, channel: authority.channel! }),
        }), catch: () => new SchedulesPermissionError({ stage: "destination" }) })
        const required = Permissions.ViewChannel | (write ? Permissions.SendMessages | (hasEmbed ? Permissions.EmbedLinks : 0n) : 0n)
        const botTimeout = authority.bot.communicationDisabledUntil
        const context: SchedulesContext = { observedAt, actor: moderationActor(authority), channelId, botId: authority.botId,
            botAuthorized: (bits.bot & required) === required && botTimeout !== undefined && (botTimeout === null || Number.isFinite(Date.parse(botTimeout)) && Date.parse(botTimeout) <= observedAt),
            actorAuthorized: (bits.actor & required) === required,
            member: { ...member, canView: (bits.actor & Permissions.ViewChannel) !== 0n, canReadHistory: (bits.actor & Permissions.ReadMessageHistory) !== 0n } }
        if (write && (!context.botAuthorized || !context.actorAuthorized || !context.member!.canReadHistory || (bits.bot & Permissions.ReadMessageHistory) === 0n)) {
            return yield* Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
        }
        return context
    })
}
// Automatic deliveries act as the bot with its fresh destination permission
export function readAutomationContext(client: Client, serverId: string, channelId: string, hasEmbed: boolean) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const permission = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | (hasEmbed ? Permissions.EmbedLinks : 0n)
        const authority = yield* readSafetyAuthority(client, serverId, botId, { channelId, permission })
        const observedAt = yield* Clock.currentTimeMillis, timeout = authority.bot.communicationDisabledUntil
        const textChannel = authority.channel?.type === ChannelType.Text || authority.channel?.type === ChannelType.Announcement
        const timedOut = timeout === undefined || timeout !== null && !(Date.parse(timeout) <= observedAt)
        if (!authority.botPermissionAuthorized || !textChannel || timedOut) return yield* Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
        const context: SchedulesAutomationContext = { observedAt, channelId, botId: authority.botId, botAuthorized: true }
        return context
    })
}
