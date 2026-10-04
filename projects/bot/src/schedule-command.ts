import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type ScheduleCommand =
    | { type: "help" }
    | { type: "query", operation: C.SchedulesQueryRequest["operation"] }
    | { type: "create", name: string, source: C.SchedulesContentSource, channelId: string, localMinute: string, zone: string, fold: C.CivilFoldPolicy, recurrence: C.CivilRecurrence }
    | { type: "calendar", scheduleNo: number, expectedRevision: number, localMinute: string, zone: string, fold: C.CivilFoldPolicy, recurrence: C.CivilRecurrence }
    | { type: "manage", operation: Exclude<C.SchedulesManageOperation, { type: "create" | "calendar" | "forget" | "reconcile" }> }
    | { type: "reconcile", scheduleNo: number, expectedRevision: number, postNo: number }
    | { type: "forget", scheduleNo: number, expectedRevision: number, confirmed: boolean, occurrenceNos?: number[] }

const integer = (value: string | undefined, max = Number.MAX_SAFE_INTEGER) => value !== undefined && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : undefined
const name = (value: string | undefined) => value !== undefined && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)
const source = (args: readonly string[]): C.SchedulesContentSource | undefined => args.length === 3 && ["draft", "template"].includes(args[0]!) && name(args[1]) && integer(args[2])
    ? { kind: args[0] as C.PublishingKind, name: args[1]!, revision: Number(args[2]) } : undefined
function calendar(args: readonly string[]) {
    if (args.length !== 3 && args.length !== 6 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(args[0] ?? "")
        || !args[1] || args[1].length > 128 || !["reject", "earlier", "later"].includes(args[2]!)) return undefined
    let recurrence: C.CivilRecurrence = { type: "none" }
    if (args.length === 6) {
        if (!["daily", "weekly"].includes(args[3]!) || !integer(args[4], 12) || !integer(args[5], 26)) return undefined
        recurrence = { type: args[3] as "daily" | "weekly", interval: Number(args[4]), count: Number(args[5]) }
    }
    return { localMinute: args[0]!, zone: args[1], fold: args[2] as C.CivilFoldPolicy, recurrence }
}
export const scheduleHelp = [
    "!publish schedule create <name> draft|template <source-name> <source-revision> #channel YYYY-MM-DDTHH:mm IANA/Zone reject|earlier|later [daily|weekly <1-12 interval> <1-26 count>]",
    "!publish schedule update <schedule> <management-revision> content draft|template <source-name> <source-revision>",
    "!publish schedule update <schedule> <management-revision> time YYYY-MM-DDTHH:mm IANA/Zone reject|earlier|later [daily|weekly <interval> <count>]",
    "!publish schedule update <schedule> <management-revision> destination #channel",
    "!publish schedule show <schedule> | list [before-schedule-number] | status [schedule [after-occurrence-number]]",
    "!publish schedule enable|disable|cancel <schedule> <management-revision>",
    "!publish schedule reconcile <schedule> <management-revision> <exact-tracked-post-number>",
    "!publish schedule forget <schedule> <management-revision> [occurrence-number ...] [confirm]",
    "!publish schedule module on|off <settings-revision> | help",
    "Created disabled. Enable skips already-due unclaimed occurrences. Frozen content and dates never follow source edits",
    "Owner/admin commands. Replies and previews are visible in the invoking channel. Mentions never notify",
].join("\n")
export function scheduleCritical(command: ScheduleCommand | { error: string }) {
    return !("error" in command) && (command.type === "query" || command.type === "forget" || command.type === "reconcile"
        || command.type === "manage" && (command.operation.type === "disable" || command.operation.type === "cancel" || command.operation.type === "settings" && !command.operation.enabled))
}
export function parseScheduleCommand(args: readonly string[]): ScheduleCommand | { error: string } {
    const error = { error: "Check quoting, exact revisions and finite dates. Use !publish schedule help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && args.length <= 2 && (args.length === 1 || integer(args[1]))) return { type: "query", operation: { type: "list", ...(args[1] ? { beforeScheduleNo: Number(args[1]) } : {}) } }
    if (verb === "status" && args.length === 1) return { type: "query", operation: { type: "status" } }
    if (verb === "show" && args.length === 2 && integer(args[1])) return { type: "query", operation: { type: "show", scheduleNo: Number(args[1]) } }
    if (verb === "status" && args.length >= 2 && args.length <= 3 && integer(args[1]) && (args.length === 2 || integer(args[2]))) return { type: "query", operation: { type: "deliveries", scheduleNo: Number(args[1]), ...(args[2] ? { afterOccurrenceNo: Number(args[2]) } : {}) } }
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[1]!) && integer(args[2])) return { type: "manage", operation: { type: "settings", enabled: args[1] === "on", expectedRevision: Number(args[2]) } }
    if (verb === "create" && name(args[1]) && commandId(args[5])) {
        const contentSource = source(args.slice(2, 5)), dates = calendar(args.slice(6))
        if (contentSource && dates) return { type: "create", name: args[1]!, source: contentSource, channelId: commandId(args[5])!, ...dates }
    }
    if (!integer(args[1]) || !integer(args[2])) return error
    const scheduleNo = Number(args[1]), expectedRevision = Number(args[2])
    if (["enable", "disable", "cancel"].includes(verb!) && args.length === 3) return { type: "manage", operation: { type: verb as "enable" | "disable" | "cancel", scheduleNo, expectedRevision } }
    if (verb === "reconcile" && args.length === 4 && integer(args[3])) return { type: "reconcile", scheduleNo, expectedRevision, postNo: Number(args[3]) }
    if (verb === "forget") {
        const confirmed = args.at(-1) === "confirm", selected = args.slice(3, confirmed ? -1 : undefined)
        if (selected.length <= 20 && selected.every(v => integer(v)) && new Set(selected).size === selected.length)
            return { type: "forget", scheduleNo, expectedRevision, confirmed, ...(selected.length ? { occurrenceNos: selected.map(Number) } : {}) }
    }
    if (verb === "update") {
        if (args[3] === "content") {
            const contentSource = source(args.slice(4))
            if (contentSource) return { type: "manage", operation: { type: "content", scheduleNo, expectedRevision, source: contentSource } }
        }
        if (args[3] === "destination" && args.length === 5 && commandId(args[4])) return { type: "manage", operation: { type: "destination", scheduleNo, expectedRevision, channelId: commandId(args[4])! } }
        if (args[3] === "time") {
            const dates = calendar(args.slice(4))
            if (dates) return { type: "calendar", scheduleNo, expectedRevision, ...dates }
        }
    }
    return error
}
