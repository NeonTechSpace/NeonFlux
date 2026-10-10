import { hierarchy, Permissions, type GuildMember, type GuildRole } from "@neontechspace/fluxerly/effect"

// Fluxer's own names where the key differs, as the permission settings show them
const labels: Record<string, string> = { ManageGuild: "Manage Server", UpdateRtcRegion: "Update RTC Region", SendTtsMessages: "Send TTS Messages", UseVad: "Use Voice Activity" }
/** The readable name of a Permissions key, such as Kick Members for KickMembers */
export const permissionLabel = (name: string) => labels[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2")
/** The Permissions keys of the bits in mask */
export const permissionNames = (mask: bigint) => Object.entries(Permissions).filter(([, bit]) => (mask & bit) !== 0n).map(([name]) => name)
const list = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
/** Items joined for a sentence, such as Autorole, Reaction roles and Role picker */
export const sentenceList = list

/** Readable permission names joined for a sentence, such as Kick Members and Ban Members */
export const labelList = (names: readonly string[]) => list(names.map(permissionLabel))

/**
 * One sentence that says what to change when the bot lacks permissions or ranks too low, such as
 * "Grant Kick Members to the NeonFlux role and move it above <@&role>". permissions are Permissions keys,
 * channelId names a channel whose overrides matter and roles are roles the bot's highest role must rank above
 */
export function fixSentence({ permissions = [], channelId, roles = [] }: { permissions?: readonly string[], channelId?: string | undefined, roles?: readonly string[] }) {
    const above = list(roles.map(id => `<@&${id}>`))
    const grant = permissions.length ? `Grant ${list(permissions.map(permissionLabel))} to the NeonFlux role${channelId ? ` and allow ${permissions.length > 1 ? "them" : "it"} in <#${channelId}>` : ""}` : ""
    return grant && above ? `${grant} and move it above ${above}` : grant || `Move the NeonFlux role above ${above}`
}

/** The fix for an SDK operation error that Fluxer refused for a missing permission, from the permissions the SDK names for it */
export function nativeFix(error: unknown, channelId?: string) {
    const required = (error as { details?: { requiredPermissions?: unknown } } | null)?.details?.requiredPermissions
    return Array.isArray(required) && required.length && required.every(name => typeof name === "string")
        ? fixSentence({ permissions: required as string[], channelId }) : undefined
}

/** A member's highest explicit role, which decides whom they can manage */
export function highestRole(member: GuildMember, roles: readonly GuildRole[]) {
    return roles.filter(role => member.roleIds.includes(role.id))
        .reduce<GuildRole | undefined>((highest, role) => !highest || hierarchy.isAbove(role, highest) ? role : highest, undefined)
}
