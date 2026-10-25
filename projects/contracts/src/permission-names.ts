// Fluxer's permission titles by bit and by SDK name, for the backend and the website, which cannot load the SDK. A bot test compares every
// entry with the SDK

/** Each permission as the SDK names it, with its bit and the title Fluxer's own client shows */
const permissions: readonly (readonly [key: string, bit: number, title: string])[] = [
    ["CreateInstantInvite", 0, "Create invite links"],
    ["KickMembers", 1, "Kick members"],
    ["BanMembers", 2, "Ban members"],
    ["Administrator", 3, "Administrator"],
    ["ManageChannels", 4, "Manage channels"],
    ["ManageGuild", 5, "Manage community"],
    ["AddReactions", 6, "Add reactions"],
    ["ViewAuditLog", 7, "View activity log"],
    ["PrioritySpeaker", 8, "Priority speaker"],
    ["Stream", 9, "Stream video"],
    ["ViewChannel", 10, "View channel"],
    ["SendMessages", 11, "Send messages"],
    ["SendTtsMessages", 12, "Send TTS messages"],
    ["ManageMessages", 13, "Manage messages"],
    ["EmbedLinks", 14, "Embed links"],
    ["AttachFiles", 15, "Attach files"],
    ["ReadMessageHistory", 16, "Read message history"],
    ["MentionEveryone", 17, "Use @everyone/@here and @roles"],
    ["UseExternalEmojis", 18, "Use external emoji"],
    ["Connect", 20, "Connect to voice"],
    ["Speak", 21, "Speak"],
    ["MuteMembers", 22, "Mute members"],
    ["DeafenMembers", 23, "Deafen members"],
    ["MoveMembers", 24, "Move members"],
    ["UseVad", 25, "Use voice activity"],
    ["ChangeNickname", 26, "Change own nickname"],
    ["ManageNicknames", 27, "Manage nicknames"],
    ["ManageRoles", 28, "Manage roles"],
    ["ManageWebhooks", 29, "Manage webhooks"],
    ["ManageExpressions", 30, "Manage emoji & stickers"],
    ["ManageThreads", 34, "Manage threads"],
    ["CreatePublicThreads", 35, "Create public threads"],
    ["CreatePrivateThreads", 36, "Create private threads"],
    ["UseExternalStickers", 37, "Use external stickers"],
    ["SendMessagesInThreads", 38, "Send messages in threads"],
    ["ModerateMembers", 40, "Time out members"],
    ["CreateExpressions", 43, "Create emoji & stickers"],
    ["PinMessages", 51, "Pin messages"],
    ["BypassSlowmode", 52, "Bypass slowmode"],
    ["UpdateRtcRegion", 53, "Set voice region"],
    ["ViewChannelMembers", 54, "View channel members"],
]
/** The title of each permission bit */
export const permissionTitles: Readonly<Record<number, string>> = Object.fromEntries(
    permissions.map(([, bit, title]) => [bit, title]),
)
/** The title of each permission by the name the SDK and the backend's setup problems use */
export const permissionKeyTitles: Readonly<Record<string, string>> = Object.fromEntries(
    permissions.map(([key, , title]) => [key, title]),
)
/** The titles of the permissions in a decimal bitfield, in bit order, with the bits Fluxer has no title for counted as one entry */
export function permissionNames(bits: string): string[] {
    const mask = BigInt(bits),
        names: string[] = []
    let unnamed = false
    for (let bit = 0; bit < 64; bit++) {
        if (!(mask & (1n << BigInt(bit)))) continue
        const title = permissionTitles[bit]
        if (title) names.push(title)
        else unnamed = true
    }
    return unnamed ? [...names, "unnamed permissions"] : names
}
/** The titles of a bitfield's permissions as one list, or none */
export const permissionList = (bits: string) => permissionNames(bits).join(", ") || "none"
/** A channel's permissions for one role or member in words, as the restore check and the audit log's Details show them */
export const overwriteText = (p: { allow: string; deny: string }) =>
    `Allow ${permissionList(p.allow)}. Deny ${permissionList(p.deny)}`
