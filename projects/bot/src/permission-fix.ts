import { format, permissionBits, Permissions, type PermissionName } from "@neontechspace/fluxerly/effect"

/** The Permissions keys of the bits in mask */
export const permissionNames = (mask: bigint) => [...permissionBits.inspect(mask).names]
const list = (items: readonly string[]) =>
    items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
/** Items joined for a sentence, such as Autorole and Reaction roles */
export const sentenceList = list

/**
 * Readable permission names joined for a sentence, such as Kick members and Ban members. Keys travel as strings through contracts
 * and stored entries, and the SDK throws for one it does not know, so such a key shows as it is
 */
export const labelList = (keys: readonly string[]) =>
    list(keys.map((key) => (Object.hasOwn(Permissions, key) ? permissionBits.label(key as PermissionName) : key)))

/**
 * One sentence that says what to change when the bot lacks permissions or ranks too low, such as
 * "Grant Kick members to the NeonFlux role and move it above <@&role>". permissions are Permissions keys,
 * channelId names a channel whose overrides matter and roles are roles the bot's highest role must rank above
 */
export function fixSentence({
    permissions = [],
    channelId,
    roles = [],
}: {
    permissions?: readonly string[]
    channelId?: string | undefined
    roles?: readonly string[]
}) {
    const above = list(roles.map(format.roleMention))
    const grant = permissions.length
        ? `Grant ${labelList(permissions)} to the NeonFlux role${channelId ? ` and allow ${permissions.length > 1 ? "them" : "it"} in ${format.channelMention(channelId)}` : ""}`
        : ""
    return grant && above ? `${grant} and move it above ${above}` : grant || `Move the NeonFlux role above ${above}`
}
