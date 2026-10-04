import type { CleanupContext } from "@neonflux/contracts/cleanup"
import { ChannelType, permissionBits, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import {
    channelPermissionInput,
    memberTimeout,
    readAuthenticatedBotId,
    readSafetyAuthority,
    readNativeAccount,
    nativeBotAccount,
    nativeHumanAccount,
} from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { memberFacts } from "./member-evidence.ts"

export class CleanupPermissionError extends Data.TaggedError("CleanupPermissionError")<{
    readonly stage: "identity" | "member" | "channel" | "channelType" | "authority"
}> {}
export function readCleanupContext(
    client: Client,
    serverId: string,
    actorId: string,
    channelId: string,
    destructive = false,
    automation = false,
) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, { channelId })
        if ((!automation && !authority.isOwner && !authority.isAdmin) || !authority.channel)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "authority" }))
        if (authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "channelType" }))
        const actor = yield* readNativeAccount(client, actorId)
        // Automatic work acts as the bot, so one read covers both
        const self = automation ? actor : yield* readNativeAccount(client)
        if (actor?.id !== actorId || self?.id !== authority.botId)
            return yield* Effect.fail(new CleanupPermissionError({ stage: "identity" }))
        const actorKind: CleanupContext["actorKind"] = actor.isBot
            ? "bot"
            : nativeHumanAccount(actor)
              ? "human"
              : "unknown"
        const botKind: CleanupContext["botKind"] = nativeBotAccount(self) ? "bot" : "unknown"
        const member = memberFacts(authority.actor, serverId, actorId),
            botMember = memberFacts(authority.bot, serverId, authority.botId)
        const observedAt = yield* Clock.currentTimeMillis
        if (
            !member ||
            !botMember ||
            Date.parse(member.joinedAt) > observedAt ||
            Date.parse(botMember.joinedAt) > observedAt
        )
            return yield* Effect.fail(new CleanupPermissionError({ stage: "member" }))
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
            catch: () => new CleanupPermissionError({ stage: "channel" }),
        })
        const requiredPermissions = ["ViewChannel", "ReadMessageHistory", "ManageMessages"] as const
        const actorAuthorized =
            permissionBits.hasAll(bits.actor, requiredPermissions) &&
            memberTimeout(client, authority.actor, observedAt) === "none"
        const botAuthorized =
            permissionBits.hasAll(bits.bot, requiredPermissions) &&
            memberTimeout(client, authority.bot, observedAt) === "none"
        const view = (value: bigint) => permissionBits.has(value, "ViewChannel")
        const history = (value: bigint) => permissionBits.has(value, "ReadMessageHistory")
        const context: CleanupContext = {
            originServerId: authority.guild.id,
            observedAt,
            actor: moderationActor(authority),
            channelId,
            channelType: authority.channel.type,
            botId: authority.botId,
            actorKind,
            botKind,
            actorAuthorized,
            botAuthorized,
            member: { ...member, canView: view(bits.actor), canReadHistory: history(bits.actor) },
            botMember: { ...botMember, canView: view(bits.bot), canReadHistory: history(bits.bot) },
        }
        const refused = automation
            ? botKind !== "bot" || !botAuthorized
            : actorKind !== "human" || botKind !== "bot" || (destructive && (!actorAuthorized || !botAuthorized))
        if (refused) return yield* Effect.fail(new CleanupPermissionError({ stage: "authority" }))
        return context
    })
}
/** Automatic cleanup acts as the bot under the server policy, never as the configuring admin */
export function readCleanupAutomationContext(client: Client, serverId: string, channelId: string) {
    return readAuthenticatedBotId(client).pipe(
        Effect.flatMap((botId) => readCleanupContext(client, serverId, botId, channelId, true, true)),
    )
}
