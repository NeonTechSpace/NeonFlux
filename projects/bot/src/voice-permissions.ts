import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { moderationActor } from "./moderation.ts"
import { channelPermissionInput, readSafetyAuthority } from "./safety-permissions.ts"

/**
 * Fresh native authority for voice commands. The actor's Manage Channels bit, read in the room when one is named,
 * feeds the moderation staff rule. Bot bits use the same reads, so native writes follow this check directly
 */
export function readVoiceAuthority(client: Client, serverId: string, actorId: string, channelId?: string) {
    return readSafetyAuthority(client, serverId, actorId, { permission: Permissions.ManageChannels, ...(channelId ? { channelId } : {}) }).pipe(Effect.map(authority => ({
        authority, actor: moderationActor(authority),
        botBits: client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) }),
    })))
}
