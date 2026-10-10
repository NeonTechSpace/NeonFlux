import {
    LFG_ACTIVITY_LENGTH,
    LFG_LIMITS,
    LFG_NOTE_LENGTH,
    LFG_START_MINUTES,
    type LfgSettingsPatch,
} from "@neonflux/contracts/lfg"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, durationSeconds } from "./command-arguments.ts"

export type LfgCommand =
    | { type: "help" }
    | { type: "list"; next: boolean }
    | { type: "create"; activity: string; size: number; startsInMinutes?: number; note?: string }
    | { type: "join" | "leave" | "start" | "cancel"; groupNo: number }
    | { type: "config" }
    | { type: "config-set"; patch: LfgSettingsPatch }

export const lfgHelp = [
    '!lfg "activity" <size> [in <time>] [note]: Post a group, such as !lfg "Deep Rock" 4 in 30m bring mics. The size counts you',
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
    `!lfg config expiry <${LFG_LIMITS.expiryMinutes.join("-")}>: Minutes a group stays open`,
    `!lfg config size <${LFG_LIMITS.maxSize.join("-")}>: The largest group, counting the host`,
    `!lfg config hosting <${LFG_LIMITS.memberGroups.join("-")}>: Open groups one member can host`,
    `!lfg config open <${LFG_LIMITS.serverGroups.join("-")}>: Open groups the server allows`,
]

/** A start time such as 30m, 2h or 1d from now in whole minutes, at most seven days */
export function lfgStartMinutes(value: string | undefined) {
    const seconds = durationSeconds(value, 60, LFG_START_MINUTES * 60)
    return seconds !== undefined && seconds % 60 === 0 ? seconds / 60 : undefined
}
const reserved = new Set(["help", "list", "join", "leave", "start", "cancel", "config"])
/** Configuration is a manager command. Every other form is a member command */
export const lfgStaff = (command: LfgCommand | { error: string }) =>
    "type" in command && command.type.startsWith("config")

export function parseLfgCommand(args: readonly string[]): LfgCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "list" && (args.length === 1 || (args.length === 2 && args[1]!.toLowerCase() === "next")))
        return { type: "list", next: args.length === 2 }
    if (verb === "join" || verb === "leave" || verb === "start" || verb === "cancel") {
        const groupNo =
            args.length === 2
                ? commands.parseArgument(args[1]!.replace(/^#/, ""), { type: "integer", min: 1, max: 99999 })
                : undefined
        return groupNo ? { type: verb, groupNo } : { error: `Name the group number, such as !lfg ${verb} 3` }
    }
    if (verb === "config") return parseConfig(args.slice(1))
    if (reserved.has(verb)) return { error: "Check the command. Use !lfg help" }
    const activity = args[0]!.trim(),
        size = commands.parseArgument(args[1], {
            type: "integer",
            min: LFG_LIMITS.maxSize[0],
            max: LFG_LIMITS.maxSize[1],
        })
    if (!activity || activity.length > LFG_ACTIVITY_LENGTH || /[\r\n]/.test(activity))
        return {
            error: `Activities need 1 to ${LFG_ACTIVITY_LENGTH} characters on one line. Quote names with spaces, such as !lfg "Deep Rock" 4`,
        }
    if (!size)
        return {
            error: `Give the group size from ${LFG_LIMITS.maxSize[0]} to ${LFG_LIMITS.maxSize[1]} after the activity, counting yourself, such as !lfg "Deep Rock" 4`,
        }
    let rest = args.slice(2),
        startsInMinutes: number | undefined
    if (rest[0]?.toLowerCase() === "in" && rest.length > 1) {
        startsInMinutes = lfgStartMinutes(rest[1])
        if (!startsInMinutes) return { error: "Start times look like in 30m, in 2h or in 1d, up to 7 days ahead" }
        rest = rest.slice(2)
    }
    const note = rest.join(" ").trim()
    if (note.length > LFG_NOTE_LENGTH || /[\r\n]/.test(note))
        return { error: `Notes need up to ${LFG_NOTE_LENGTH} characters on one line` }
    return {
        type: "create",
        activity,
        size,
        ...(startsInMinutes ? { startsInMinutes } : {}),
        ...(note ? { note } : {}),
    }
}

function parseConfig(args: readonly string[]): LfgCommand | { error: string } {
    if (!args.length) return { type: "config" }
    const field = args[0]!.toLowerCase(),
        value = args[1],
        single = args.length === 2
    if ((field === "on" || field === "off") && args.length === 1)
        return { type: "config-set", patch: { enabled: field === "on" } }
    if ((field === "channel" || field === "generator") && single) {
        const channelId = value!.toLowerCase() === "none" ? null : commands.parseArgument(value, argument.channel)
        if (channelId !== undefined)
            return {
                type: "config-set",
                patch: field === "channel" ? { channelId } : { generatorChannelId: channelId },
            }
    }
    const limits = {
        expiry: ["expiryMinutes", ...LFG_LIMITS.expiryMinutes],
        size: ["maxSize", ...LFG_LIMITS.maxSize],
        hosting: ["memberGroups", ...LFG_LIMITS.memberGroups],
        open: ["serverGroups", ...LFG_LIMITS.serverGroups],
    } as const
    if (Object.hasOwn(limits, field) && single) {
        const [key, min, max] = limits[field as keyof typeof limits],
            number = commands.parseArgument(value, { type: "integer", min, max })
        return number
            ? { type: "config-set", patch: { [key]: number } }
            : { error: `Choose ${field} from ${min} to ${max}` }
    }
    return { error: "Check the setting. Use !lfg help" }
}
