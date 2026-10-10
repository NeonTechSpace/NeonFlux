import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"
import { milestoneMonthDay } from "./milestone-calendar.ts"

export type MilestoneRouteName = "birthday" | "anniversary"
export type MilestoneCommand =
    | { type: "help" }
    | { type: "me" }
    | { type: "remove", route?: MilestoneRouteName }
    | { type: "enroll", route: MilestoneRouteName, monthDay?: string, channel: string }
    | { type: "module", enabled: boolean }
    | { type: "configure", route: MilestoneRouteName, channelId: string, zone: string, time: string, fold: C.CivilFoldPolicy, templateName: string }
    | { type: "enable" | "disable" | "clear", route: MilestoneRouteName }
    | { type: "status", route?: MilestoneRouteName, next: boolean }
    | { type: "preview", route: MilestoneRouteName }
    | { type: "reconcile", route: MilestoneRouteName, postNo: number }
    | { type: "forget", route: MilestoneRouteName, postNo: number, confirmed: boolean }
const integer = (v: string | undefined) => !!v && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v))
const channelArg = (v: string | undefined) => !!v && v.length <= 100
const routeName = (v: string | undefined): v is MilestoneRouteName => v === "birthday" || v === "anniversary"

export const milestoneHelp = [
    "!milestone me: What you signed up for, in a DM",
    "!milestone birthday set MM-DD confirm #channel: Sign up for a public birthday post there, with no year, in a DM",
    "!milestone anniversary on confirm #channel: Sign up for a public post on the day you joined, in a DM",
    "!milestone remove [birthday|anniversary]: Remove your sign-up and date, in a DM",
    "!milestone configure birthday|anniversary #channel <zone> HH:mm reject template <name>: Where and when posts go",
    "!milestone enable|disable birthday|anniversary: Start or stop posting",
    "!milestone module on|off: Turn birthdays and anniversaries on or off",
    "Send !milestone help all for the other commands",
].join("\n")
/** The forms !milestone help leaves out, listed by !milestone help all */
export const milestoneHelpAll = [
    "!milestone status [birthday|anniversary [next]]: The settings, or one kind's recent posts",
    "!milestone preview birthday|anniversary: See a post privately",
    "!milestone clear birthday|anniversary: Remove one kind's settings",
    "!milestone reconcile birthday|anniversary <post-number>: Check a post that was not confirmed",
    "!milestone forget birthday|anniversary <post-number> [confirm]: Stop following a finished post. The post stays",
    "Use earlier or later in place of reject to pick the time a clock change repeats",
]
export function milestonePersonal(command: MilestoneCommand | { error: string }) {
    return !("error" in command) && ["help", "me", "remove", "enroll"].includes(command.type)
}
export function milestoneCritical(command: MilestoneCommand | { error: string }) {
    return !("error" in command) && (["help", "me", "remove", "status", "disable", "clear", "forget", "reconcile"].includes(command.type) || command.type === "module" && !command.enabled)
}
export function parseMilestoneCommand(args: readonly string[]): MilestoneCommand | { error: string } {
    const error = { error: "Check the syntax. Use !milestone help. Personal commands require a verified one-to-one DM" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "me" && args.length === 1) return { type: "me" }
    if (verb === "remove" && (args.length === 1 || args.length === 2 && routeName(args[1]))) return { type: "remove", ...(args[1] ? { route: args[1] as MilestoneRouteName } : {}) }
    if (verb === "birthday" && args.length === 5 && args[1] === "set" && milestoneMonthDay(args[2]!) && args[3] === "confirm" && channelArg(args[4])) {
        return { type: "enroll", route: "birthday", monthDay: args[2]!, channel: args[4]! }
    }
    if (verb === "anniversary" && args.length === 4 && args[1] === "on" && args[2] === "confirm" && channelArg(args[3])) {
        return { type: "enroll", route: "anniversary", channel: args[3]! }
    }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", enabled: args[1] === "on" }
    if (verb === "status" && (args.length === 1 || routeName(args[1]) && (args.length === 2 || args.length === 3 && args[2] === "next"))) return { type: "status", ...(args[1] ? { route: args[1] as MilestoneRouteName } : {}), next: args[2] === "next" }
    if (verb === "preview" && args.length === 2 && routeName(args[1])) return { type: "preview", route: args[1] }
    if (!routeName(args[1])) return error
    const route = args[1]
    if (verb === "configure" && args.length === 8 && commandId(args[2]) && args[3] && args[3].length <= 128 && /^([01]\d|2[0-3]):[0-5]\d$/.test(args[4]!)
        && ["earlier", "later", "reject"].includes(args[5]!) && args[6] === "template" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(args[7]!)) return {
            type: "configure", route, channelId: commandId(args[2])!, zone: args[3], time: args[4]!, fold: args[5] as C.CivilFoldPolicy, templateName: args[7]!,
        }
    if (["enable", "disable", "clear"].includes(verb!) && args.length === 2) return { type: verb as "enable" | "disable" | "clear", route }
    if (!integer(args[2])) return error
    if (verb === "reconcile" && args.length === 3) return { type: "reconcile", route, postNo: Number(args[2]) }
    if (verb === "forget" && (args.length === 3 || args.length === 4 && args[3] === "confirm")) return { type: "forget", route, postNo: Number(args[2]), confirmed: args[3] === "confirm" }
    return error
}
