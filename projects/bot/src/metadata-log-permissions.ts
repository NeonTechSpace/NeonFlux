import type { MetadataLogsContext } from "@neonflux/contracts/metadata-logs"
import { permissionBits, ChannelType, Permissions, type Client, type GuildMember } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import {
    channelPermissionInput,
    memberTimeout,
    readAuthenticatedBotId,
    readSafetyAuthority,
    SafetyPermissionError,
    readNativeAccount,
    nativeBotAccount,
    nativeHumanAccount,
} from "./safety-permissions.ts"
import { verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { memberFacts } from "./member-evidence.ts"

export class MetadataLogPermissionError extends Data.TaggedError("MetadataLogPermissionError")<{
    readonly stage: "identity" | "member" | "channel" | "channelType" | "authority" | "private" | "missing"
}> {}
/**
 * Stage missing means Fluxer answered that the channel does not exist. A timeout, rate limit, server error or any other failed read
 * stays an authority failure, which delivery tries again later
 */
const permissionFailure = (error: unknown) =>
    error instanceof MetadataLogPermissionError
        ? error
        : new MetadataLogPermissionError({
              stage:
                  error instanceof SafetyPermissionError && error.operation === "channel" && error.notFound
                      ? "missing"
                      : "authority",
          })
/** Inspect registered guild destinations, including category parents, without asserting delivery eligibility */
export function readMetadataDestinationEvidence(client: Client, serverId: string, actorId: string, channelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, { channelId })
        if (!authority.channel) return yield* Effect.fail(new MetadataLogPermissionError({ stage: "channel" }))
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
            catch: () => new MetadataLogPermissionError({ stage: "channel" }),
        })
        const observedAt = yield* Clock.currentTimeMillis
        const grants = (b: bigint, member: GuildMember) => ({
            view: permissionBits.has(b, "ViewChannel"),
            send:
                (b & (Permissions.ViewChannel | Permissions.SendMessages)) ===
                    (Permissions.ViewChannel | Permissions.SendMessages) &&
                memberTimeout(client, member, observedAt) === "none",
            embed: permissionBits.has(b, "EmbedLinks"),
            history:
                (b & (Permissions.ViewChannel | Permissions.ReadMessageHistory)) ===
                (Permissions.ViewChannel | Permissions.ReadMessageHistory),
            audit: permissionBits.has(b, "ViewAuditLog"),
            manageRoles: permissionBits.has(b, "ManageRoles"),
        })
        return {
            authority,
            observedAt,
            permissions: grants(bits.bot, authority.bot),
            ownerPermissions: grants(bits.actor, authority.actor),
        }
    }).pipe(Effect.mapError(permissionFailure))
}
export function readMetadataLogContext(
    client: Client,
    serverId: string,
    actorId: string,
    channelId: string,
    privateChannel = false,
    automation = false,
) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, privateChannel ? {} : { channelId })
        if (!automation && !authority.isOwner && !authority.isAdmin)
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "authority" }))
        const privateProof = privateChannel ? yield* verifyTicketPrivateAuthor(client, channelId, actorId) : undefined
        if (!privateChannel) {
            if (!authority.channel) return yield* Effect.fail(new MetadataLogPermissionError({ stage: "channel" }))
            if (authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement)
                return yield* Effect.fail(new MetadataLogPermissionError({ stage: "channelType" }))
        }
        // Automation acts as the bot itself, so one account read covers both
        const actor = yield* readNativeAccount(client, actorId)
        const self = automation ? actor : yield* readNativeAccount(client)
        if (
            actor?.id !== actorId ||
            self?.id !== authority.botId ||
            (!automation && !nativeHumanAccount(actor)) ||
            !nativeBotAccount(self)
        )
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "identity" }))
        const member = memberFacts(authority.actor, serverId, actorId),
            botMember = memberFacts(authority.bot, serverId, authority.botId)
        const observedAt = yield* Clock.currentTimeMillis
        if (
            !member ||
            !botMember ||
            Date.parse(member.joinedAt) > observedAt ||
            Date.parse(botMember.joinedAt) > observedAt
        )
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "member" }))
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
            catch: () => new MetadataLogPermissionError({ stage: "channel" }),
        })
        const required = Permissions.ViewChannel | Permissions.SendMessages
        const botRequired = required | Permissions.EmbedLinks | Permissions.ReadMessageHistory
        const view = (b: bigint) => !privateChannel && permissionBits.has(b, "ViewChannel")
        const history = (b: bigint) => !privateChannel && permissionBits.has(b, "ReadMessageHistory")
        const context: MetadataLogsContext = {
            originServerId: authority.guild.id,
            observedAt,
            actor: moderationActor(authority),
            channelId,
            channelType: privateChannel ? 1 : (authority.channel!.type as 0 | 5),
            botId: authority.botId,
            actorKind: automation ? "bot" : "human",
            botKind: "bot",
            actorAuthorized:
                !privateChannel &&
                (bits.actor & required) === required &&
                memberTimeout(client, authority.actor, observedAt) === "none",
            botAuthorized:
                !privateChannel &&
                (bits.bot & botRequired) === botRequired &&
                memberTimeout(client, authority.bot, observedAt) === "none",
            member: { ...member, canView: view(bits.actor), canReadHistory: history(bits.actor) },
            botMember: { ...botMember, canView: view(bits.bot), canReadHistory: history(bits.bot) },
        }
        return {
            context,
            authority,
            privateRead: privateProof
                ? {
                      originServerId: authority.guild.id,
                      channelId,
                      recipientIds: [...privateProof.channel.recipients.map((r) => r.id), authority.botId].filter(
                          (id, index, all) => all.indexOf(id) === index,
                      ),
                      oneToOne: true as const,
                  }
                : undefined,
            permissions: {
                view: view(bits.bot),
                send: !privateChannel && (bits.bot & required) === required,
                embed: !privateChannel && permissionBits.has(bits.bot, "EmbedLinks"),
                history: history(bits.bot),
                audit: permissionBits.has(bits.bot, "ViewAuditLog"),
            },
        }
    }).pipe(Effect.mapError(permissionFailure))
}
/** Automatic delivery acts as the bot under the server policy, never as the configuring admin */
export function readMetadataLogAutomationContext(client: Client, serverId: string, channelId: string) {
    return readAuthenticatedBotId(client).pipe(
        Effect.flatMap((botId) => readMetadataLogContext(client, serverId, botId, channelId, false, true)),
    )
}
