import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"
import { milestoneMonthDay } from "./milestone-calendar.ts"

export type MilestoneRouteName = "birthday" | "anniversary"
export type MilestoneCommand =
    | { type: "help" }
    | { type: "me" }
    | { type: "remove", route?: MilestoneRouteName }
    | { type: "enroll", route: MilestoneRouteName, monthDay?: string, channel: string }
    | { type: "module", enabled: boolean, expectedRevision: number }
    | { type: "configure", route: MilestoneRouteName, expectedRevision: number, channelId: string, zone: string, time: string, fold: C.CivilFoldPolicy, templateName: string, templateRevision: number }
    | { type: "enable" | "disable" | "clear", route: MilestoneRouteName, expectedRevision: number }
    | { type: "status", route?: MilestoneRouteName, cursor?: string }
    | { type: "preview", route: MilestoneRouteName }
    | { type: "reconcile", route: MilestoneRouteName, postNo: number }
    | { type: "forget", route: MilestoneRouteName, postNo: number, confirmed: boolean }
const integer = (v: string | undefined) => !!v && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v))
const channelArg = (v: string | undefined) => !!v && v.length <= 100
const routeName = (v: string | undefined): v is MilestoneRouteName => v === "birthday" || v === "anniversary"

export const milestoneHelp = [
    "Private DM: !milestone me | remove [birthday|anniversary]",
    "Private DM: !milestone birthday set MM-DD confirm #channel | anniversary on confirm #channel (a channel mention, ID or name)",
    "Consent permits a public celebration in that exact configured channel using the server route timezone. Read me before consenting",
    "Birthday stores month/day only, never a birth year or age. A changed destination requires your new consent, even if it later returns",
    "Removal deletes enrollment and stored month/day. Prior native posts, original DM history and truthful claimed publishing history remain. Terminal tracking lasts 30 days, body-free annual fences 400 days, unresolved ownership until settled",
    "Owner/admin: !milestone module on|off <settings-revision>",
    "!milestone configure birthday|anniversary <route-revision> #channel IANA/Zone HH:mm earlier|later|reject template <name> <revision>",
    "!milestone enable|disable|clear birthday|anniversary <route-revision>",
    "!milestone status [birthday|anniversary [quoted-cursor]] | preview birthday|anniversary",
    "!milestone reconcile birthday|anniversary <exact-post-number>",
    "!milestone forget birthday|anniversary <exact-settled-post-number> [confirm]",
    "Routes and module start off. Publishing is enabled separately. Suggested local time: 09:00. A late celebration still posts later that local day",
    "All replies are private. Staff cannot opt members in or list their birthdays. Mentions never notify",
].join("\n")
export function milestonePersonal(command: MilestoneCommand | { error: string }) {
    return !("error" in command) && ["help", "me", "remove", "enroll"].includes(command.type)
}
export function milestoneCritical(command: MilestoneCommand | { error: string }) {
    return !("error" in command) && (["help", "me", "remove", "status", "disable", "clear", "forget", "reconcile"].includes(command.type) || command.type === "module" && !command.enabled)
}
export function parseMilestoneCommand(args: readonly string[]): MilestoneCommand | { error: string } {
    const error = { error: "Check exact revisions and syntax. Use !milestone help. Personal commands require a verified one-to-one DM" }
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
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[1]!) && integer(args[2])) return { type: "module", enabled: args[1] === "on", expectedRevision: Number(args[2]) }
    if (verb === "status" && (args.length === 1 || routeName(args[1]) && (args.length === 2 || args.length === 3 && !!args[2] && args[2].length <= 4096))) return { type: "status", ...(args[1] ? { route: args[1] as MilestoneRouteName } : {}), ...(args[2] ? { cursor: args[2] } : {}) }
    if (verb === "preview" && args.length === 2 && routeName(args[1])) return { type: "preview", route: args[1] }
    if (!routeName(args[1]) || !(integer(args[2]) || verb === "configure" && args[2] === "0")) return error
    const route = args[1], expectedRevision = Number(args[2])
    if (verb === "configure" && args.length === 10 && commandId(args[3]) && args[4] && args[4].length <= 128 && /^([01]\d|2[0-3]):[0-5]\d$/.test(args[5]!)
        && ["earlier", "later", "reject"].includes(args[6]!) && args[7] === "template" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(args[8]!) && integer(args[9])) return {
            type: "configure", route, expectedRevision, channelId: commandId(args[3])!, zone: args[4], time: args[5]!, fold: args[6] as C.CivilFoldPolicy, templateName: args[8]!, templateRevision: Number(args[9]),
        }
    if (["enable", "disable", "clear"].includes(verb!) && args.length === 3) return { type: verb as "enable" | "disable" | "clear", route, expectedRevision }
    if (verb === "reconcile" && args.length === 3) return { type: "reconcile", route, postNo: Number(args[2]) }
    if (verb === "forget" && (args.length === 3 || args.length === 4 && args[3] === "confirm")) return { type: "forget", route, postNo: Number(args[2]), confirmed: args[3] === "confirm" }
    return error
}
