import type { VoiceGeneratorPatch } from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type VoiceRoomControl =
    | { type: "rename", roomId?: string, name: string }
    | { type: "hide" | "show", roomId?: string }
    | { type: "allow" | "block", roomId?: string, userId: string }
    | { type: "limit", roomId?: string, limit: number }
export type VoiceCommand =
    | { type: "help" }
    | { type: "generator-add", channelName: string, categoryId: string | null }
    | { type: "generator-list" }
    | { type: "generator-remove", channelId: string }
    | { type: "generator-set", channelId: string, patch: VoiceGeneratorPatch }
    | VoiceRoomControl

export const voiceHelp = [
    "Generators (staff):",
    "!voice generator add \"Join to create\" [category-ID|none]",
    "!voice generator list",
    "!voice generator remove #generator",
    "!voice generator set #generator name \"New name\"",
    "!voice generator set #generator category <category-ID|none>",
    "!voice generator set #generator template \"{owner}'s room\"",
    "!voice generator set #generator limit <1-99|none>",
    "!voice generator set #generator region <region-ID|auto>",
    "Your room (owner or staff, add #room to choose one):",
    "!voice rename \"New name\" | hide | show | allow @member | block @member | limit <0-99, 0 for none>",
].join("\n")

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
const visible = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
export const voiceName = (value: string) => value.length <= 100 && visible(value) ? value.trim() : undefined
export const voiceTemplateValue = (value: string) => voiceName(value) !== undefined && !/[{}]/.test(value.replaceAll("{owner}", "")) ? value.trim() : undefined
const whole = (value: string | undefined, min: number, max: number) => value !== undefined && /^\d{1,2}$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
const nameError = { error: "Names need 1 to 100 characters" }

/** Room controls are member actions. Generator commands are staff configuration */
export const voicePublic = (command: VoiceCommand | { error: string }) => !("error" in command) && !command.type.startsWith("generator-")

export function parseVoiceCommand(args: readonly string[]): VoiceCommand | { error: string } {
    const error = { error: "Check the voice command syntax. Use !voice help" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "generator") return parseGenerator(args.slice(1), error)
    // An optional leading room mention or ID selects another room, otherwise the invoker's own room
    const rest = args.slice(1), roomFirst = rest.length > 1 || ["hide", "show"].includes(verb) && rest.length === 1 ? commandId(rest[0]) : undefined
    const room = roomFirst ? { roomId: roomFirst } : {}, values = roomFirst ? rest.slice(1) : rest
    if (verb === "hide" || verb === "show") return values.length === 0 ? { type: verb, ...room } : error
    if (verb === "rename") { const name = voiceName(values.join(" ")); return values.length && name ? { type: "rename", ...room, name } : nameError }
    if (verb === "allow" || verb === "block") { const userId = values.length === 1 ? commandId(values[0]) : undefined; return userId ? { type: verb, ...room, userId } : { error: `Use !voice ${verb} [#room] @member` } }
    if (verb === "limit") { const limit = values.length === 1 ? whole(values[0], 0, 99) : undefined; return limit !== undefined ? { type: "limit", ...room, limit } : { error: "Member limits are 0 to 99, where 0 removes the limit" } }
    return error
}

function parseGenerator(args: readonly string[], error: { error: string }): VoiceCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (verb === "list" && args.length === 1) return { type: "generator-list" }
    if (verb === "add" && args.length >= 2) {
        const last = args.at(-1)!, category = args.length > 2 && (last.toLowerCase() === "none" || commandId(last)) ? last : undefined
        const channelName = voiceName((category ? args.slice(1, -1) : args.slice(1)).join(" "))
        if (!channelName) return nameError
        return { type: "generator-add", channelName, categoryId: category === undefined || category.toLowerCase() === "none" ? null : commandId(category)! }
    }
    const channelId = commandId(args[1])
    if (verb === "remove" && args.length === 2 && channelId) return { type: "generator-remove", channelId }
    if (verb !== "set" || !channelId || args.length < 4) return error
    const field = args[2]!.toLowerCase(), values = args.slice(3), value = values.join(" "), single = values.length === 1 ? values[0]!.toLowerCase() : undefined
    if (field === "name") { const channelName = voiceName(value); return channelName ? { type: "generator-set", channelId, patch: { channelName } } : nameError }
    if (field === "template") {
        const template = voiceTemplateValue(value)
        return template ? { type: "generator-set", channelId, patch: { template } } : { error: "Templates need 1 to 100 characters and support only the {owner} placeholder" }
    }
    if (field === "category" && single) return single === "none" || commandId(single) ? { type: "generator-set", channelId, patch: { categoryId: single === "none" ? null : commandId(single)! } } : error
    if (field === "limit" && single) {
        const limit = single === "none" ? null : whole(single, 1, 99)
        return limit !== undefined ? { type: "generator-set", channelId, patch: { userLimit: limit } } : { error: "Default member limits are none or 1 to 99" }
    }
    if (field === "region" && single) {
        if (single === "auto") return { type: "generator-set", channelId, patch: { region: null } }
        return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values[0]!) ? { type: "generator-set", channelId, patch: { region: values[0]! } } : { error: "Regions are auto or a region ID of 1 to 64 letters, digits, dots, underscores or hyphens" }
    }
    return error
}
