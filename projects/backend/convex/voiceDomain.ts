import type { ModerationActor, ModerationSettings, VoiceGeneratorPatch } from "../contracts.js"
import { administrator } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, requireId } from "./validation.ts"

export const VOICE_GENERATOR_LIMIT = 10, VOICE_ROOM_LIMIT = 50

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
const visible = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
export function voiceChannelName(value: unknown): string {
    if (typeof value !== "string" || value.length > 100 || !visible(value)) fail(400, "Channel names need 1 to 100 characters")
    return value.trim()
}
export function voiceTemplate(value: unknown): string {
    if (typeof value !== "string" || value.length > 100 || !visible(value)) fail(400, "Room name templates need 1 to 100 characters")
    if (/[{}]/.test(value.replaceAll("{owner}", ""))) fail(400, "Room name templates support only the {owner} placeholder")
    return value.trim()
}
export function voiceUserLimit(value: unknown): number | null {
    if (value === null) return null
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 99) fail(400, "Default member limits are none or 1 to 99")
    return value
}
export function voiceRegion(value: unknown): string | null {
    if (value === null) return null
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) fail(400, "Regions are automatic or a region ID of 1 to 64 letters, digits, dots, underscores or hyphens")
    return value
}
export const voiceCategory = (value: unknown): string | null => value === null ? null : requireId(value)
export function voicePatch(value: unknown): VoiceGeneratorPatch {
    const raw = shape(value, ["channelName", "categoryId", "template", "userLimit", "region"]), patch: VoiceGeneratorPatch = {}
    if (!Object.keys(raw).length) fail(400, "Choose a generator setting")
    if (raw.channelName !== undefined) patch.channelName = voiceChannelName(raw.channelName)
    if (raw.categoryId !== undefined) patch.categoryId = voiceCategory(raw.categoryId)
    if (raw.template !== undefined) patch.template = voiceTemplate(raw.template)
    if (raw.userLimit !== undefined) patch.userLimit = voiceUserLimit(raw.userLimit)
    if (raw.region !== undefined) patch.region = voiceRegion(raw.region)
    return patch
}
// The moderation staff rule that governs channel management, as for slowmode: Owner, Administrator,
// or a moderation staff role together with a fresh native Manage Channels read. DEFCON 1 leaves only owners and Administrators
export function voiceStaff(actor: ModerationActor, settings: ModerationSettings) {
    const staff = administrator(actor) || actor.nativePermissionAuthorized && actor.roleIds.some(id => settings.staffRoleIds.moderation.includes(id))
    return staff && (settings.defcon !== 1 || administrator(actor))
}
