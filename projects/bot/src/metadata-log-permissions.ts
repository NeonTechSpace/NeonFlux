import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { cleanupRecord } from "./cleanup-permissions.ts"
import { readAuthenticatedBotId, readSafetyAuthority, nativeHumanAccount as metadataHumanAccount } from "./safety-permissions.ts"
import { verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { levelingMember } from "./member-evidence.ts"

export class MetadataLogPermissionError extends Data.TaggedError("MetadataLogPermissionError")<{ readonly stage: "identity" | "member" | "channel" | "authority" | "private" }> {}
export { nativeHumanAccount as metadataHumanAccount } from "./safety-permissions.ts"
/** Inspect registered guild destinations, including category parents, without asserting delivery eligibility */
export function readMetadataDestinationEvidence(client: Client, serverId: string, actorId: string, channelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, { channelId })
        if (!authority.channel) return yield* Effect.fail(new MetadataLogPermissionError({ stage: "channel" }))
        const bits = yield* Effect.try({ try: () => ({ actor: client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, channel: authority.channel! }),
            bot: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, channel: authority.channel! }) }), catch: () => new MetadataLogPermissionError({ stage: "channel" }) })
        const observedAt = yield* Clock.currentTimeMillis
        const clear = (value: string | null | undefined) => value === null || typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= observedAt
        const grants = (b: bigint, timeout: string | null | undefined) => ({ view: (b & Permissions.ViewChannel) !== 0n, send: (b & (Permissions.ViewChannel | Permissions.SendMessages)) === (Permissions.ViewChannel | Permissions.SendMessages) && clear(timeout),
            embed: (b & Permissions.EmbedLinks) !== 0n, history: (b & (Permissions.ViewChannel | Permissions.ReadMessageHistory)) === (Permissions.ViewChannel | Permissions.ReadMessageHistory), audit: (b & Permissions.ViewAuditLog) !== 0n, manageRoles: (b & Permissions.ManageRoles) !== 0n })
        return { authority, observedAt, permissions: grants(bits.bot, authority.bot.communicationDisabledUntil), ownerPermissions: grants(bits.actor, authority.actor.communicationDisabledUntil) }
    }).pipe(Effect.mapError(() => new MetadataLogPermissionError({ stage: "authority" })))
}
export function readMetadataLogContext(client: Client, serverId: string, actorId: string, channelId: string, privateChannel = false, automation = false) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId, privateChannel ? {} : { channelId })
        if (!automation && !authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new MetadataLogPermissionError({ stage: "authority" }))
        const privateProof = privateChannel ? yield* verifyTicketPrivateAuthor(client, channelId, actorId) : undefined
        if (!privateChannel && (!authority.channel || authority.channel.type !== ChannelType.Text && authority.channel.type !== ChannelType.Announcement))
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "channel" }))
        const actorResponse = yield* client.rest.request({ method: "GET", path: `/users/${actorId}`, timeoutMs: 5000 })
        const botResponse = yield* client.rest.request({ method: "GET", path: "/users/@me", timeoutMs: 5000 })
        const rawActor = cleanupRecord(actorResponse.body), rawBot = cleanupRecord(botResponse.body)
        if (actorResponse.status !== 200 || botResponse.status !== 200 || rawActor?.id !== actorId || rawBot?.id !== authority.botId
            || !automation && !metadataHumanAccount(rawActor) || rawBot.bot !== true || rawBot.system !== undefined && rawBot.system !== false)
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "identity" }))
        const member = levelingMember(authority.actor, serverId, actorId), botMember = levelingMember(authority.bot, serverId, authority.botId)
        const observedAt = yield* Clock.currentTimeMillis
        if (!member || !botMember || Date.parse(member.joinedAt) > observedAt || Date.parse(botMember.joinedAt) > observedAt)
            return yield* Effect.fail(new MetadataLogPermissionError({ stage: "member" }))
        const bits = yield* Effect.try({ try: () => ({ actor: client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, ...(authority.channel ? { channel: authority.channel } : {}) }),
            bot: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...(authority.channel ? { channel: authority.channel } : {}) }) }), catch: () => new MetadataLogPermissionError({ stage: "channel" }) })
        const clear = (timeout: string | null) => timeout === null || Number.isFinite(Date.parse(timeout)) && Date.parse(timeout) <= observedAt
        const required = Permissions.ViewChannel | Permissions.SendMessages
        const botRequired = required | Permissions.EmbedLinks | Permissions.ReadMessageHistory
        const view = (b: bigint) => !privateChannel && (b & Permissions.ViewChannel) !== 0n
        const history = (b: bigint) => !privateChannel && (b & Permissions.ReadMessageHistory) !== 0n
        const context: C.MetadataLogsContext = { observedAt, actor: moderationActor(authority), channelId,
            channelType: privateChannel ? 1 : authority.channel!.type as 0 | 5,
            botId: authority.botId, actorKind: automation ? "bot" : "human", botKind: "bot", actorAuthorized: !privateChannel && (bits.actor & required) === required && clear(member.timeoutUntil),
            botAuthorized: !privateChannel && (bits.bot & botRequired) === botRequired && clear(botMember.timeoutUntil),
            member: { ...member, canView: view(bits.actor), canReadHistory: history(bits.actor) }, botMember: { ...botMember, canView: view(bits.bot), canReadHistory: history(bits.bot) } }
        return { context, authority, privateRead: privateProof ? { channelId, recipientIds: [...privateProof.channel.recipients.map(r => r.id), authority.botId].filter((id, index, all) => all.indexOf(id) === index), oneToOne: true as const } : undefined,
            permissions: { view: view(bits.bot), send: !privateChannel && (bits.bot & required) === required, embed: !privateChannel && (bits.bot & Permissions.EmbedLinks) !== 0n,
                history: history(bits.bot), audit: (bits.bot & Permissions.ViewAuditLog) !== 0n } }
    }).pipe(Effect.mapError(() => new MetadataLogPermissionError({ stage: "authority" })))
}
/** Automatic delivery acts as the bot under the server policy, never as the configuring admin */
export function readMetadataLogAutomationContext(client: Client, serverId: string, channelId: string) {
    return readAuthenticatedBotId(client).pipe(Effect.flatMap(botId => readMetadataLogContext(client, serverId, botId, channelId, false, true)))
}
