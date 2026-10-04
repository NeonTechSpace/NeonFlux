import type { SchedulesAutomationContext, SchedulesContext } from "@neonflux/contracts/schedules"
import { permissionBits, ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readComposerAuthority } from "./publishing-permissions.ts"
import {
    channelPermissionInput,
    memberTimeout,
    readAuthenticatedBotId,
    readSafetyAuthority,
} from "./safety-permissions.ts"

export class SchedulesPermissionError extends Data.TaggedError("SchedulesPermissionError")<{
    readonly stage: "destination"
}> {}
export function readSchedulesContext(
    client: Client,
    serverId: string,
    userId: string,
    channelId: string,
    write = false,
    hasEmbed = false,
) {
    return readComposerAuthority(client, serverId, userId, channelId, { staff: true, write, hasEmbed }).pipe(
        Effect.flatMap(({ context, authority }) => {
            if (!write) return Effect.succeed<SchedulesContext>(context)
            const botBits = client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            })
            return context.member?.canReadHistory && permissionBits.has(botBits, "ReadMessageHistory")
                ? Effect.succeed<SchedulesContext>(context)
                : Effect.fail(new SchedulesPermissionError({ stage: "destination" }))
        }),
    )
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
