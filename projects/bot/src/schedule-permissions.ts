import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readEventsAuthority } from "./publishing-permissions.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export class SchedulesPermissionError extends Data.TaggedError("SchedulesPermissionError")<{ readonly stage: "destination" }> {}
export function readSchedulesContext(client: Client, serverId: string, userId: string, channelId: string, write = false, hasEmbed = false) {
    return readEventsAuthority(client, serverId, userId, channelId, { staff: true, write, hasEmbed }).pipe(Effect.flatMap(({ context, authority }) => {
        if (!write) return Effect.succeed<C.SchedulesContext>(context)
        const botBits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, channel: authority.channel! })
        return context.member?.canReadHistory && (botBits & Permissions.ReadMessageHistory) !== 0n
            ? Effect.succeed<C.SchedulesContext>(context) : Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
    }))
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
        const context: C.SchedulesAutomationContext = { observedAt, channelId, botId: authority.botId, botAuthorized: true }
        return context
    })
}
