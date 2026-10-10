import type { ModerationSettings } from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { VoiceCategory, VoiceChannelName, VoiceGeneratorPatch, VoiceRegion, VoiceTemplate, VoiceUserLimit } from "@neonflux/contracts/voice"
import { administrator } from "./moderationDomain.ts"
import { decode } from "./validation.ts"

export { VOICE_GENERATOR_LIMIT, VOICE_ROOM_LIMIT } from "@neonflux/contracts/voice"

// Dashboard configuration jobs validate generator settings with these. Channel names and templates come back trimmed
export const voiceChannelName = (value: unknown): string => decode(VoiceChannelName, value).trim()
export const voiceTemplate = (value: unknown): string => decode(VoiceTemplate, value).trim()
export const voiceUserLimit = (value: unknown): number | null => decode(VoiceUserLimit, value)
export const voiceRegion = (value: unknown): string | null => decode(VoiceRegion, value)
export const voiceCategory = (value: unknown): string | null => decode(VoiceCategory, value)
export function voicePatch(value: unknown): VoiceGeneratorPatch {
    const patch = decode(VoiceGeneratorPatch, value)
    return { ...patch, ...(patch.channelName !== undefined ? { channelName: patch.channelName.trim() } : {}), ...(patch.template !== undefined ? { template: patch.template.trim() } : {}) }
}
// The moderation staff rule that governs channel management, as for slowmode: Owner, Administrator,
// or a moderation staff role together with a fresh native Manage Channels read. DEFCON 1 leaves only owners and Administrators
export function voiceStaff(actor: ModerationActor, settings: ModerationSettings) {
    const staff = administrator(actor) || actor.nativePermissionAuthorized && actor.roleIds.some(id => settings.staffRoleIds.moderation.includes(id))
    return staff && (settings.defcon !== 1 || administrator(actor))
}
