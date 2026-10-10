import { commandId } from "./moderation-command.ts"

export type CleanupCommand =
    | { type: "help" }
    | { type: "list" }
    | { type: "status", channelId?: string, beforeTargetNo?: number }
    | { type: "show" | "preview", channelId: string }
    | { type: "configure", channelId: string, expectedRevision: number, ageMs: number }
    | { type: "enable", channelId: string, expectedRevision: number, confirmed: boolean }
    | { type: "disable", channelId: string, expectedRevision: number }
    | { type: "module", enabled: boolean, expectedRevision: number }
    | { type: "exclude", channelId: string, expectedRevision: number, kind: "author" | "message", add: boolean, id: string }

const revision = (v: string | undefined, zero = false) => v !== undefined && (zero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(v) && Number.isSafeInteger(Number(v))
export function cleanupAge(value: string | undefined) {
    const match = /^(\d+)(m|h|d)$/.exec(value ?? "")
    if (!match) return undefined
    const age = Number(match[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[match[2] as "m" | "h" | "d"])
    return Number.isSafeInteger(age) && age >= 3600000 && age <= 365 * 86400000 ? age : undefined
}
export const cleanupHelp = [
    "!cleanup configure #channel <revision, 0 for new> <age: 1h through 365d>",
    "!cleanup show|preview #channel | list | status [#channel [before-target-number]]",
    "!cleanup enable #channel <revision> [confirm] | disable #channel <revision>",
    "!cleanup module on|off <settings-revision>",
    "!cleanup exclude #channel <revision> author|message add|remove <exact-id>",
    "!cleanup help",
    "Created disabled. Enable may delete existing messages older than the configured age",
    "A policy also covers the channel's active threads. Archived threads wait until they are active again, and preview samples the channel only",
    "Pinned, unknown, bot, webhook, system, excluded and protected messages remain. Preview is read-only and bounded",
    "Owner/admin commands. Replies contain metadata only and are visible in the invoking channel",
].join("\n")
export function cleanupCritical(command: CleanupCommand | { error: string }) {
    return !("error" in command) && (["show", "list", "status", "preview", "disable"].includes(command.type)
        || command.type === "module" && !command.enabled)
}
export function parseCleanupCommand(args: readonly string[]): CleanupCommand | { error: string } {
    const error = { error: "Check exact IDs, revisions and age. Use !cleanup help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb && !args.length || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "status" && args.length <= 3 && (args.length === 1 || commandId(args[1])) && (args.length < 3 || revision(args[2]))) return { type: "status", ...(args[1] ? { channelId: commandId(args[1])! } : {}), ...(args[2] ? { beforeTargetNo: Number(args[2]) } : {}) }
    if ((verb === "show" || verb === "preview") && args.length === 2 && commandId(args[1])) return { type: verb, channelId: commandId(args[1])! }
    if (verb === "module" && args.length === 3 && (args[1] === "on" || args[1] === "off") && revision(args[2])) return { type: "module", enabled: args[1] === "on", expectedRevision: Number(args[2]) }
    const channelId = commandId(args[1])
    if (!channelId || !revision(args[2], verb === "configure")) return error
    const expectedRevision = Number(args[2])
    if (verb === "configure" && args.length === 4 && cleanupAge(args[3]) !== undefined) return { type: "configure", channelId, expectedRevision, ageMs: cleanupAge(args[3])! }
    if (verb === "disable" && args.length === 3) return { type: "disable", channelId, expectedRevision }
    if (verb === "enable" && (args.length === 3 || args.length === 4 && args[3] === "confirm")) return { type: "enable", channelId, expectedRevision, confirmed: args[3] === "confirm" }
    if (verb === "exclude" && args.length === 6 && (args[3] === "author" || args[3] === "message") && (args[4] === "add" || args[4] === "remove") && commandId(args[5])) return { type: "exclude", channelId, expectedRevision, kind: args[3], add: args[4] === "add", id: commandId(args[5])! }
    return error
}
