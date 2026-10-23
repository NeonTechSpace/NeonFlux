import { isVoiceChannelName, isVoiceRegion, isVoiceTemplate, type VoiceGeneratorPatch } from "@neonflux/contracts/voice"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, wholeNumber } from "./command-arguments.ts"

export type VoiceRoomControl =
    | { type: "rename"; roomId?: string; name: string }
    | { type: "hide" | "show"; roomId?: string }
    | { type: "allow" | "block"; roomId?: string; userId: string }
    | { type: "limit"; roomId?: string; limit: number }
export type VoiceCommand =
    | { type: "help" }
    | { type: "generator-add"; channelName: string; categoryId: string | null }
    | { type: "generator-list" }
    | { type: "generator-remove"; channelId: string }
    | { type: "generator-set"; channelId: string; patch: VoiceGeneratorPatch }
    | VoiceRoomControl
    /** A member in a room whose owner left takes it, or its owner or staff give it to a member in it */
    | { type: "claim" }
    | { type: "transfer"; userId: string }

export const voiceHelp = [
    '!voice rename "name": Rename your room',
    "!voice hide|show: Hide your room or show it again",
    "!voice allow|block @member: Let a member in or keep them out",
    "!voice limit <0-99>: Your room's member limit, 0 for none",
    "!voice claim: Take over the room you are in when its owner left",
    '!voice generator add "Join to create" [category-ID|none]: Add a channel that makes a room for each member who joins',
    "!voice generator list: The room generators",
    "!voice generator remove #generator: Remove a generator",
    "Send !voice help all for the other commands",
].join("\n")
/** The forms !voice help leaves out, listed by !voice help all */
export const voiceHelpAll = [
    "!voice transfer @member: Give your room to someone in it",
    "!voice rename|hide|show|allow|block|limit #room ...: Control a room you name, for staff",
    '!voice generator set #generator name "name": Rename a generator',
    "!voice generator set #generator category <category-ID|none>: Where its rooms go",
    '!voice generator set #generator template "{owner}\'s room": How new rooms are named',
    "!voice generator set #generator limit <1-99|none>: The member limit of new rooms",
    "!voice generator set #generator region <region-ID|auto>: The voice region of new rooms",
]

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
const voiceName = (value: string) => (isVoiceChannelName(value) ? value.trim() : undefined)
const voiceTemplateValue = (value: string) => (isVoiceTemplate(value) ? value.trim() : undefined)
const nameError = { error: "Names need 1 to 100 characters" }

/** Room controls are member actions. Generator commands are staff configuration */
export const voicePublic = (command: VoiceCommand | { error: string }) =>
    !("error" in command) && !command.type.startsWith("generator-")

export function parseVoiceCommand(args: readonly string[]): VoiceCommand | { error: string } {
    const error = { error: "Check the voice command syntax. Use !voice help" }
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "generator") return parseGenerator(args.slice(1), error)
    // An optional leading room mention or ID selects another room, otherwise the invoker's own room. A bare ID needs
    // a snowflake's length, so a name such as "5 stack" stays a name
    const rest = args.slice(1),
        roomFirst =
            (rest.length > 1 || (["hide", "show"].includes(verb) && rest.length === 1)) &&
            /^(?:<#\d+>|\d{15,20})$/.test(rest[0]!)
                ? commands.parseArgument(rest[0], argument.channel)
                : undefined
    const room = roomFirst ? { roomId: roomFirst } : {},
        values = roomFirst ? rest.slice(1) : rest
    if (verb === "claim") return args.length === 1 ? { type: "claim" } : error
    if (verb === "transfer") {
        const userId = args.length === 2 ? commands.parseArgument(args[1], argument.user) : undefined
        return userId ? { type: "transfer", userId } : { error: "Use !voice transfer @member" }
    }
    if (verb === "hide" || verb === "show") return values.length === 0 ? { type: verb, ...room } : error
    if (verb === "rename") {
        const name = voiceName(values.join(" "))
        return values.length && name ? { type: "rename", ...room, name } : nameError
    }
    if (verb === "allow" || verb === "block") {
        const userId = values.length === 1 ? commands.parseArgument(values[0], argument.user) : undefined
        return userId ? { type: verb, ...room, userId } : { error: `Use !voice ${verb} [#room] @member` }
    }
    if (verb === "limit") {
        const limit = values.length === 1 ? wholeNumber(values[0], 0, 99) : undefined
        return limit !== undefined
            ? { type: "limit", ...room, limit }
            : { error: "Member limits are 0 to 99, where 0 removes the limit" }
    }
    return error
}

function parseGenerator(args: readonly string[], error: { error: string }): VoiceCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (verb === "list" && args.length === 1) return { type: "generator-list" }
    if (verb === "add" && args.length >= 2) {
        // A final category ID or none is the category, and any other final word belongs to the name
        const last = args.at(-1)!,
            categoryId =
                args.length > 2
                    ? last.toLowerCase() === "none"
                        ? null
                        : commands.parseArgument(last, argument.channel)
                    : undefined
        const channelName = voiceName((categoryId === undefined ? args.slice(1) : args.slice(1, -1)).join(" "))
        if (!channelName) return nameError
        return { type: "generator-add", channelName, categoryId: categoryId ?? null }
    }
    const channelId = commands.parseArgument(args[1], argument.channel)
    if (verb === "remove" && args.length === 2 && channelId) return { type: "generator-remove", channelId }
    if (verb !== "set" || !channelId || args.length < 4) return error
    const field = args[2]!.toLowerCase(),
        values = args.slice(3),
        value = values.join(" "),
        single = values.length === 1 ? values[0]!.toLowerCase() : undefined
    if (field === "name") {
        const channelName = voiceName(value)
        return channelName ? { type: "generator-set", channelId, patch: { channelName } } : nameError
    }
    if (field === "template") {
        const template = voiceTemplateValue(value)
        return template
            ? { type: "generator-set", channelId, patch: { template } }
            : { error: "Templates need 1 to 100 characters and support only the {owner} placeholder" }
    }
    if (field === "category" && single) {
        const categoryId = single === "none" ? null : commands.parseArgument(single, argument.channel)
        return categoryId !== undefined ? { type: "generator-set", channelId, patch: { categoryId } } : error
    }
    if (field === "limit" && single) {
        const limit = single === "none" ? null : commands.parseArgument(single, { type: "integer", min: 1, max: 99 })
        return limit !== undefined
            ? { type: "generator-set", channelId, patch: { userLimit: limit } }
            : { error: "Default member limits are none or 1 to 99" }
    }
    if (field === "region" && single) {
        if (single === "auto") return { type: "generator-set", channelId, patch: { region: null } }
        return isVoiceRegion(values[0]!)
            ? { type: "generator-set", channelId, patch: { region: values[0]! } }
            : { error: "Regions are auto or a region ID of 1 to 64 letters, digits, dots, underscores or hyphens" }
    }
    return error
}
