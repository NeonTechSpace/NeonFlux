import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { channelPermissionInput, readAuthenticatedBotId, readSafetyAuthority, nativeHumanAccount } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { levelingMember } from "./member-evidence.ts"

export class CleanupPermissionError extends Data.TaggedError("CleanupPermissionError")<{ readonly stage: "identity" | "member" | "channel" | "authority" }> {}
export const cleanupRecord = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
export function readCleanupContext(client: Client, serverId: string, actorId: string, channelId: string, destructive = false, automation = false) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, { channelId })
        if (!automation && !authority.isOwner && !authority.isAdmin || !authority.channel || authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "authority" }))
        // The native partial-user contract omits bot/system when false: https://docs.fluxer.app/http-api/users/#partial-user-object
        const actorResponse = yield* client.rest.request({ method: "GET", path: `/users/${actorId}`, timeoutMs: 5000 })
        const botResponse = yield* client.rest.request({ method: "GET", path: "/users/@me", timeoutMs: 5000 })
        const rawActor = cleanupRecord(actorResponse.body), rawBot = cleanupRecord(botResponse.body)
        if (actorResponse.status !== 200 || botResponse.status !== 200 || rawActor?.id !== actorId || rawBot?.id !== authority.botId)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "identity" }))
        const actorKind: C.CleanupContext["actorKind"] = rawActor.bot === true ? "bot" : nativeHumanAccount(rawActor) ? "human" : "unknown"
        const botKind: C.CleanupContext["botKind"] = rawBot.bot === true && (rawBot.system === undefined || rawBot.system === false) ? "bot" : "unknown"
        const member = levelingMember(authority.actor, serverId, actorId), botMember = levelingMember(authority.bot, serverId, authority.botId)
        const observedAt = yield* Clock.currentTimeMillis
        if (!member || !botMember || Date.parse(member.joinedAt) > observedAt || Date.parse(botMember.joinedAt) > observedAt)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "member" }))
        const bits = yield* Effect.try({ try: () => ({ actor: client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, ...channelPermissionInput(authority) }),
            bot: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) }) }), catch: () => new CleanupPermissionError({ stage: "channel" }) })
        const required = Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.ManageMessages
        const timeoutClear = (value: string | null) => value === null || Number.isFinite(Date.parse(value)) && Date.parse(value) <= observedAt
        const actorAuthorized = (bits.actor & required) === required && timeoutClear(member.timeoutUntil)
        const botAuthorized = (bits.bot & required) === required && timeoutClear(botMember.timeoutUntil)
        const view = (value: bigint) => (value & Permissions.ViewChannel) !== 0n
        const history = (value: bigint) => (value & Permissions.ReadMessageHistory) !== 0n
        const context: C.CleanupContext = { originServerId: authority.guild.id, observedAt, actor: moderationActor(authority), channelId, channelType: authority.channel.type, botId: authority.botId, actorKind, botKind, actorAuthorized, botAuthorized,
            member: { ...member, canView: view(bits.actor), canReadHistory: history(bits.actor) }, botMember: { ...botMember, canView: view(bits.bot), canReadHistory: history(bits.bot) } }
        const refused = automation ? botKind !== "bot" || !botAuthorized
            : actorKind !== "human" || botKind !== "bot" || destructive && (!actorAuthorized || !botAuthorized)
        if (refused) return yield* Effect.fail(new CleanupPermissionError({ stage: "authority" }))
        return context
    })
}
/** Automatic cleanup acts as the bot under the server policy, never as the configuring admin */
export function readCleanupAutomationContext(client: Client, serverId: string, channelId: string) {
    return readAuthenticatedBotId(client).pipe(Effect.flatMap(botId => readCleanupContext(client, serverId, botId, channelId, true, true)))
}

export function cleanupTimestamp(messageId: string, createdAt: string | null) {
    if (!snowflakes.isValid(messageId) || messageId === "0" || createdAt === null || createdAt.length > 128 || !/^\d{4}-\d\d-\d\dT/.test(createdAt)) return undefined
    const timestamp = Date.parse(createdAt)
    return Number.isSafeInteger(timestamp) && timestamp >= 0 && snowflakes.createdAt(messageId).getTime() === timestamp ? timestamp : undefined
}
