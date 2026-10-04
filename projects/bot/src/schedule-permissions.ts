import type { SchedulesAutomationContext } from "@neonflux/contracts/schedules"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readComposerAuthority } from "./publishing-permissions.ts"
import { memberTimeout, readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export class SchedulesPermissionError extends Data.TaggedError("SchedulesPermissionError")<{
    readonly stage: "destination"
}> {}
export function readSchedulesContext(client: Client, serverId: string, userId: string, channelId: string) {
    return readComposerAuthority(client, serverId, userId, channelId).pipe(Effect.map(({ context }) => context))
}
// Automatic deliveries act as the bot with its fresh destination permission
export function readAutomationContext(client: Client, serverId: string, channelId: string, hasEmbed: boolean) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const permission =
            Permissions.ViewChannel |
            Permissions.SendMessages |
            Permissions.ReadMessageHistory |
            (hasEmbed ? Permissions.EmbedLinks : 0n)
        const authority = yield* readSafetyAuthority(client, serverId, botId, { channelId, permission })
        const observedAt = yield* Clock.currentTimeMillis
        const textChannel =
            authority.channel?.type === ChannelType.Text || authority.channel?.type === ChannelType.Announcement
        const timedOut = memberTimeout(client, authority.bot, observedAt) !== "none"
        if (!authority.botPermissionAuthorized || !textChannel || timedOut)
            return yield* Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
        const context: SchedulesAutomationContext = {
            originServerId: authority.guild.id,
            observedAt,
            channelId,
            botId: authority.botId,
            botAuthorized: true,
        }
        return context
    })
}
