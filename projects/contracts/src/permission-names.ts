// Fluxer's permission titles by bit, for the backend, which cannot load the SDK. A bot test compares every
// entry with the SDK

/** Each permission's bit and the title Fluxer's own client shows */
const permissions: readonly (readonly [bit: number, title: string])[] = [
    [0, "Create invite links"],
    [1, "Kick members"],
    [2, "Ban members"],
    [3, "Administrator"],
    [4, "Manage channels"],
    [5, "Manage community"],
    [6, "Add reactions"],
    [7, "View activity log"],
    [8, "Priority speaker"],
    [9, "Stream video"],
    [10, "View channel"],
    [11, "Send messages"],
    [12, "Send TTS messages"],
    [13, "Manage messages"],
    [14, "Embed links"],
    [15, "Attach files"],
    [16, "Read message history"],
    [17, "Use @everyone/@here and @roles"],
    [18, "Use external emoji"],
    [20, "Connect to voice"],
    [21, "Speak"],
    [22, "Mute members"],
    [23, "Deafen members"],
    [24, "Move members"],
    [25, "Use voice activity"],
    [26, "Change own nickname"],
    [27, "Manage nicknames"],
    [28, "Manage roles"],
    [29, "Manage webhooks"],
    [30, "Manage emoji & stickers"],
    [34, "Manage threads"],
    [35, "Create public threads"],
    [36, "Create private threads"],
    [37, "Use external stickers"],
    [38, "Send messages in threads"],
    [40, "Time out members"],
    [43, "Create emoji & stickers"],
    [51, "Pin messages"],
    [52, "Bypass slowmode"],
    [53, "Set voice region"],
    [54, "View channel members"],
]
/** The title of each permission bit */
export const permissionTitles: Readonly<Record<number, string>> = Object.fromEntries(permissions)
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
