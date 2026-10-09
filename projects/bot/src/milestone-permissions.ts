import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { levelingMember } from "./member-evidence.ts"
import { verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"
import { readEventsAuthority } from "./publishing-permissions.ts"
import { channelPermissionInput, readSafetyAuthority } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { readNativeMember } from "./member-evidence.ts"
import { commandId } from "./moderation-command.ts"

export class MilestonesPermissionError extends Data.TaggedError("MilestonesPermissionError")<{ readonly stage: "identity" | "membership" | "participant" | "destination" }> {}

// The ticket boundary already verifies the authenticated bot and exact one-to-one human recipient set.
export const verifyMilestonePrivateAuthor = verifyTicketPrivateAuthor
export const readMilestonesContext = readSchedulesContext
export function readMilestonesStaffContext(client: Client, serverId: string, actorId: string, privateChannelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, actorId)
        const member = levelingMember(authority.actor, serverId, actorId), observedAt = yield* Clock.currentTimeMillis
        if (!member || member.isBot || actorId === authority.botId || !authority.isOwner && !authority.isAdmin || Date.parse(member.joinedAt) > observedAt) return yield* Effect.fail(new MilestonesPermissionError({ stage: "identity" }))
        const context: C.MilestonesContext = { originServerId: authority.guild.id, observedAt, actor: moderationActor(authority), channelId: privateChannelId, botId: authority.botId,
            botAuthorized: false, actorAuthorized: false, member: { ...member, canView: false, canReadHistory: false } }
        return context
    })
}

export function readMilestoneParticipant(client: Client, serverId: string, userId: string, channelId: string): Effect.Effect<C.MilestonesParticipantContext, unknown> {
    return Effect.gen(function* () {
        const { context, authority } = yield* readEventsAuthority(client, serverId, userId, channelId)
        const now = yield* Clock.currentTimeMillis
        if (!context.member || context.member.isBot || !context.member.canView || !context.member.canReadHistory
            || context.member.timeoutUntil !== null && Date.parse(context.member.timeoutUntil) > now
            || !context.botAuthorized || (client.permissions.calculate({ guild: authority.guild, roles: authority.roles, member: authority.bot, ...channelPermissionInput(authority) }) & (Permissions.ViewChannel | Permissions.ReadMessageHistory)) !== (Permissions.ViewChannel | Permissions.ReadMessageHistory)) return yield* Effect.fail(new MilestonesPermissionError({ stage: "participant" }))
        return { originServerId: authority.guild.id, observedAt: now, channelId, botId: authority.botId, member: context.member, userName: authority.actor.username, serverName: authority.guild.name }
    })
}

export function readMilestoneMembership(client: Client, serverId: string, userId: string) {
    return Effect.gen(function* () {
        if (![serverId, userId].every(id => snowflakes.isValid(id) && id !== "0")) return yield* Effect.fail(new MilestonesPermissionError({ stage: "identity" }))
        const evidence = yield* readNativeMember(client, serverId, userId)
        const native = evidence.member
        const observedAt = yield* Clock.currentTimeMillis
        if (!native) return { originServerId: evidence.originServerId, status: "absent" as const, userId: evidence.userId, observedAt }
        const member = levelingMember(native, serverId, userId)
        if (!member || member.isBot || Date.parse(member.joinedAt) > observedAt || member.timeoutUntil !== null && !Number.isFinite(Date.parse(member.timeoutUntil))) return yield* Effect.fail(new MilestonesPermissionError({ stage: "membership" }))
        return { originServerId: native.guildId, status: "present" as const, userId, observedAt, member }
    })
}

// Consent names a channel by mention, ID or unique text or announcement channel name
export function resolveMilestoneChannel(client: Client, serverId: string, value: string) {
    return Effect.gen(function* () {
        const id = commandId(value)
        if (id) return { channelId: id }
        const name = value.replace(/^#/, "").toLowerCase()
        const channels = yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })
        const matches = channels.filter(c => (c.type === ChannelType.Text || c.type === ChannelType.Announcement) && c.name?.toLowerCase() === name)
        if (matches.length > 1) return { error: `Several channels are named #${name}. Confirm with a channel mention or ID instead` }
        if (!matches.length) return { error: `No text or announcement channel is named #${name}. Confirm with a channel mention, ID or exact name` }
        return { channelId: matches[0]!.id }
    })
}
