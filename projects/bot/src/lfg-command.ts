import type { LfgSettingsPatch } from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type LfgCommand =
    | { type: "help" }
    | { type: "list", next: boolean }
    | { type: "create", activity: string, size: number, startsInMinutes?: number, note?: string }
    | { type: "join" | "leave" | "start" | "cancel", groupNo: number }
    | { type: "config" }
    | { type: "config-set", patch: LfgSettingsPatch }

export const lfgHelp = [
    "!lfg \"activity\" <size> [in <time>] [note]: Post a group, such as !lfg \"Deep Rock\" 4 in 30m bring mics. The size counts you",
    "!lfg join|leave <group>: Join or leave a group",
    "!lfg start <group>: Start your group before it is full. A full group starts on its own",
    "!lfg cancel <group>: Cancel your group",
    "!lfg list [next]: The open groups",
    "!lfg config: The settings, for managers",
    "!lfg config on|off: Turn looking for group on or off",
    "Send !lfg help all for the other commands",
].join("\n")
/** The forms !lfg help leaves out, listed by !lfg help all */
export const lfgHelpAll = [
    "!lfg config channel #channel: Where group cards are posted",
    "!lfg config generator #generator|none: The voice generator whose category, limit and region group rooms use",
    "!lfg config expiry <10-1440>: Minutes a group stays open",
    "!lfg config size <2-25>: The largest group, counting the host",
    "!lfg config hosting <1-5>: Open groups one member can host",
    "!lfg config open <1-50>: Open groups the server allows",
]

const whole = (value: string | undefined, min: number, max: number) => value !== undefined && /^\d{1,5}$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
const units = { m: 1, h: 60, d: 1440 } as const
/** A start time such as 30m, 2h or 1d from now in minutes, at most seven days */
export function lfgStartMinutes(value: string | undefined) {
    const match = /^(\d{1,5})([mhd])$/i.exec(value ?? "")
    const minutes = match ? Number(match[1]) * units[match[2]!.toLowerCase() as keyof typeof units] : 0
    return minutes >= 1 && minutes <= 10080 ? minutes : undefined
}
const reserved = new Set(["help", "list", "join", "leave", "start", "cancel", "config"])
/** Configuration is a manager command. Every other form is a member command */
export const lfgStaff = (command: LfgCommand | { error: string }) => "type" in command && command.type.startsWith("config")

export function parseLfgCommand(args: readonly string[]): LfgCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && (args.length === 1 || args.length === 2 && args[1]!.toLowerCase() === "next")) return { type: "list", next: args.length === 2 }
    if (verb === "join" || verb === "leave" || verb === "start" || verb === "cancel") {
        const groupNo = args.length === 2 ? whole(args[1]!.replace(/^#/, ""), 1, Number.MAX_SAFE_INTEGER) : undefined
        return groupNo ? { type: verb, groupNo } : { error: `Name the group number, such as !lfg ${verb} 3` }
    }
    if (verb === "config") return parseConfig(args.slice(1))
    if (reserved.has(verb)) return { error: "Check the command. Use !lfg help" }
    const activity = args[0]!.trim(), size = whole(args[1], 2, 25)
    if (!activity || activity.length > 50 || /[\r\n]/.test(activity)) return { error: "Activities need 1 to 50 characters on one line. Quote names with spaces, such as !lfg \"Deep Rock\" 4" }
    if (!size) return { error: "Give the group size from 2 to 25 after the activity, counting yourself, such as !lfg \"Deep Rock\" 4" }
    let rest = args.slice(2), startsInMinutes: number | undefined
    if (rest[0]?.toLowerCase() === "in" && rest.length > 1) {
        startsInMinutes = lfgStartMinutes(rest[1])
        if (!startsInMinutes) return { error: "Start times look like in 30m, in 2h or in 1d, up to 7 days ahead" }
        rest = rest.slice(2)
    }
    const note = rest.join(" ").trim()
    if (note.length > 200 || /[\r\n]/.test(note)) return { error: "Notes need up to 200 characters on one line" }
    return { type: "create", activity, size, ...(startsInMinutes ? { startsInMinutes } : {}), ...(note ? { note } : {}) }
}

function parseConfig(args: readonly string[]): LfgCommand | { error: string } {
    if (!args.length) return { type: "config" }
    const field = args[0]!.toLowerCase(), value = args[1], single = args.length === 2
    if ((field === "on" || field === "off") && args.length === 1) return { type: "config-set", patch: { enabled: field === "on" } }
    if ((field === "channel" || field === "generator") && single) {
        const channelId = value!.toLowerCase() === "none" ? null : commandId(value)
        if (channelId !== undefined) return { type: "config-set", patch: field === "channel" ? { channelId } : { generatorChannelId: channelId } }
    }
    const limits = { expiry: ["expiryMinutes", 10, 1440], size: ["maxSize", 2, 25], hosting: ["memberGroups", 1, 5], open: ["serverGroups", 1, 50] } as const
    if (Object.hasOwn(limits, field) && single) {
        const [key, min, max] = limits[field as keyof typeof limits], number = whole(value, min, max)
        return number ? { type: "config-set", patch: { [key]: number } } : { error: `Choose ${field} from ${min} to ${max}` }
    }
    return { error: "Check the setting. Use !lfg help" }
}
