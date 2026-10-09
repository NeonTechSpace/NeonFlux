import type { ModerationSettings } from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { VoiceGeneratorPatch } from "@neonflux/contracts/voice"
import { administrator } from "./moderationDomain.ts"
import { decode } from "./validation.ts"

export { VOICE_GENERATOR_LIMIT, VOICE_ROOM_LIMIT } from "@neonflux/contracts/voice"

// Dashboard configuration jobs validate generator patches with this. Channel names and templates come back trimmed
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
