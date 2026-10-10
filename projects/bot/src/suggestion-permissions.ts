import type { SuggestionsCardContext } from "@neonflux/contracts/suggestions"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { postChannel, readEventsAuthority } from "./publishing-permissions.ts"
import { channelPermissionInput, readSafetyAuthority, readAuthenticatedBotId } from "./safety-permissions.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"

export class SuggestionsPermissionError extends Data.TaggedError("SuggestionsPermissionError")<{ readonly stage: "member" | "destination" }> {}
export function readSuggestionParticipant(client: Client, serverId: string, userId: string, channelId: string, staff = false, restricted = false) {
    return readEventsAuthority(client, serverId, userId, channelId, { staff, forum: "forum" }).pipe(Effect.flatMap(({ context, authority }) =>
        !context.member?.canView || !context.member.canReadHistory || !context.actorAuthorized || !context.botAuthorized
            || (client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) }) & Permissions.ReadMessageHistory) === 0n
            || !restricted && context.member.timeoutUntil !== null && Date.parse(context.member.timeoutUntil) > context.observedAt
            ? Effect.fail(new SuggestionsPermissionError({ stage: "member" })) : Effect.succeed(context)))
}
export const readSuggestionDestination = (client: Client, serverId: string, userId: string, channelId: string) =>
    readSchedulesContext(client, serverId, userId, channelId, true, true, "forum")
export function readSuggestionCardContext(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const permission = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks | Permissions.ReadMessageHistory
        const authority = yield* readSafetyAuthority(client, serverId, botId, { channelId, permission })
        const observedAt = yield* Clock.currentTimeMillis, timeout = authority.bot.communicationDisabledUntil
        // The destination, or once the card has its own forum post, that post
        const textChannel = postChannel(authority.channel, "post")
        const timedOut = timeout === undefined || timeout !== null && !(Date.parse(timeout) <= observedAt)
        if (!authority.botPermissionAuthorized || !textChannel || timedOut) return yield* Effect.fail(new SuggestionsPermissionError({ stage: "destination" }))
        const context: SuggestionsCardContext = { originServerId: authority.guild.id, observedAt, channelId, botId: authority.botId, botAuthorized: true }
        return context
    })
}
