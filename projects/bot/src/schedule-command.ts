import type { CivilFoldPolicy, CivilRecurrence } from "@neonflux/contracts/civil"
import type { PublishingKind, SchedulesContentSource } from "@neonflux/contracts/publishing-base"
import { commandId } from "./moderation-command.ts"

/** A draft or template named in chat. The bot reads its current revision right before the write */
export type ScheduleSource = Omit<SchedulesContentSource, "revision">
type SchedulePlan = { localMinute: string, zone: string, fold: CivilFoldPolicy, recurrence: CivilRecurrence }
export type ScheduleCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "list", next: boolean }
    | { type: "show" | "preview", name: string }
    | { type: "dates", name: string, next: boolean }
    | { type: "deliveries", name: string, next: boolean }
    | { type: "module", enabled: boolean }
    | ({ type: "create", name: string, source: ScheduleSource, channelId: string } & SchedulePlan)
    | ({ type: "calendar", name: string } & SchedulePlan)
    | { type: "content", name: string, source: ScheduleSource }
    | { type: "destination", name: string, channelId: string }
    | { type: "enable" | "disable" | "cancel", name: string }
    | { type: "reconcile", name: string, postNo: number }
    | { type: "forget", name: string, confirmed: boolean, occurrenceNos?: number[] }

const integer = (value: string | undefined, max = Number.MAX_SAFE_INTEGER) => value !== undefined && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : undefined
const name = (value: string | undefined) => value !== undefined && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.toLowerCase()) ? value.toLowerCase() : undefined
const source = (args: readonly string[]): ScheduleSource | undefined => args.length === 2 && ["draft", "template"].includes(args[0]!) && name(args[1]) ? { kind: args[0] as PublishingKind, name: name(args[1])! } : undefined
function calendar(args: readonly string[]): SchedulePlan | undefined {
    if (args.length !== 3 && args.length !== 6 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(args[0] ?? "")
        || !args[1] || args[1].length > 128 || !["reject", "earlier", "later"].includes(args[2]!)) return undefined
    let recurrence: CivilRecurrence = { type: "none" }
    if (args.length === 6) {
        if (!["daily", "weekly"].includes(args[3]!) || !integer(args[4], 12) || !integer(args[5], 26)) return undefined
        recurrence = { type: args[3] as "daily" | "weekly", interval: Number(args[4]), count: Number(args[5]) }
    }
    return { localMinute: args[0]!, zone: args[1], fold: args[2] as CivilFoldPolicy, recurrence }
}
export const scheduleHelp = [
    "!publish schedule create <name> draft|template <source> #channel YYYY-MM-DDTHH:mm <zone> reject: Plan a post",
    "!publish schedule list [next]: Your schedules",
    "!publish schedule show <name>: One schedule in short",
    "!publish schedule enable|disable <name>: Start or pause a schedule. New ones start paused",
    "!publish schedule cancel <name>: End a schedule for good",
    "!publish schedule module on|off: Turn scheduled posts on or off",
    "Send !publish schedule help all for the other commands",
].join("\n")
/** The forms !publish schedule help leaves out, listed by !publish schedule help all */
export const scheduleHelpAll = [
    "!publish schedule create <name> draft|template <source> #channel YYYY-MM-DDTHH:mm <zone> reject daily|weekly <1-12 every> <1-26 dates>: Repeat a post",
    "!publish schedule update <name> content draft|template <source>: Replace its content",
    "!publish schedule update <name> time YYYY-MM-DDTHH:mm <zone> reject [daily|weekly <every> <dates>]: Change its time",
    "!publish schedule update <name> destination #channel: Change its channel",
    "!publish schedule dates <name> [next]: Its planned dates",
    "!publish schedule preview <name>: The post it sends",
    "!publish schedule status [<name> [next]]: Whether scheduled posts are on, or one schedule's posts",
    "!publish schedule reconcile <name> <post-number>: Check a post that was not confirmed",
    "!publish schedule forget <name> [date-number ...] [confirm]: Remove finished dates. Messages stay",
    "Use earlier or later in place of reject to pick the time a clock change repeats",
]
export function scheduleCritical(command: ScheduleCommand | { error: string }) {
    return !("error" in command) && (["status", "list", "show", "dates", "preview", "deliveries", "forget", "reconcile", "disable", "cancel"].includes(command.type) || command.type === "module" && !command.enabled)
}
export function parseScheduleCommand(args: readonly string[]): ScheduleCommand | { error: string } {
    const error = { error: "Check the schedule name, values and finite dates. Use !publish schedule help for syntax" }
    const verb = args[0]?.toLowerCase(), target = name(args[1])
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && args.length <= 2 && (args.length === 1 || args[1] === "next")) return { type: "list", next: args.length === 2 }
    if (verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", enabled: args[1] === "on" }
    if (!target) return error
    if ((verb === "show" || verb === "preview") && args.length === 2) return { type: verb, name: target }
    if (verb === "dates" && args.length <= 3 && (args.length === 2 || args[2] === "next")) return { type: "dates", name: target, next: args.length === 3 }
    if (verb === "status" && args.length <= 3 && (args.length === 2 || args[2] === "next")) return { type: "deliveries", name: target, next: args.length === 3 }
    if (verb === "create" && commandId(args[4])) {
        const contentSource = source(args.slice(2, 4)), dates = calendar(args.slice(5))
        if (contentSource && dates) return { type: "create", name: target, source: contentSource, channelId: commandId(args[4])!, ...dates }
    }
    if (["enable", "disable", "cancel"].includes(verb) && args.length === 2) return { type: verb as "enable" | "disable" | "cancel", name: target }
    if (verb === "reconcile" && args.length === 3 && integer(args[2])) return { type: "reconcile", name: target, postNo: Number(args[2]) }
    if (verb === "forget") {
        const confirmed = args.at(-1) === "confirm", selected = args.slice(2, confirmed ? -1 : undefined)
        if (selected.length <= 20 && selected.every(v => integer(v)) && new Set(selected).size === selected.length)
            return { type: "forget", name: target, confirmed, ...(selected.length ? { occurrenceNos: selected.map(Number) } : {}) }
    }
    if (verb === "update") {
        const contentSource = args[2] === "content" ? source(args.slice(3)) : undefined, dates = args[2] === "time" ? calendar(args.slice(3)) : undefined
        if (contentSource) return { type: "content", name: target, source: contentSource }
        if (dates) return { type: "calendar", name: target, ...dates }
        if (args[2] === "destination" && args.length === 4 && commandId(args[3])) return { type: "destination", name: target, channelId: commandId(args[3])! }
    }
    return error
}
