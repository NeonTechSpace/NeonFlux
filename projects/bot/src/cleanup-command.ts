import { commandId } from "./moderation-command.ts"

export type CleanupCommand =
    | { type: "help" }
    | { type: "list" }
    | { type: "status", channelId?: string, next: boolean }
    | { [K in "show" | "preview"]: { type: K, channelId: string } }["show" | "preview"]
    | { type: "configure", channelId: string, ageMs: number }
    | { type: "enable", channelId: string, confirmed: boolean }
    | { type: "disable", channelId: string }
    | { type: "module", enabled: boolean }
    | { type: "exclude", channelId: string, kind: "author" | "message", add: boolean, id: string }

export function cleanupAge(value: string | undefined) {
    const match = /^(\d+)(m|h|d)$/.exec(value ?? "")
    if (!match) return undefined
    const age = Number(match[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[match[2] as "m" | "h" | "d"])
    return Number.isSafeInteger(age) && age >= 3600000 && age <= 365 * 86400000 ? age : undefined
}
export const cleanupHelp = [
    "!cleanup configure #channel <age: 1h through 365d>",
    "!cleanup show|preview #channel | list | status [#channel [next]]",
    "!cleanup enable #channel [confirm] | disable #channel",
    "!cleanup module on|off",
    "!cleanup exclude #channel author|message add|remove <exact-id>",
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
    const error = { error: "Check the channel, IDs and age. Use !cleanup help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb && !args.length || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "status" && (args.length === 1 || commandId(args[1]) && (args.length === 2 || args.length === 3 && args[2] === "next"))) return { type: "status", ...(args[1] ? { channelId: commandId(args[1])! } : {}), next: args[2] === "next" }
    if ((verb === "show" || verb === "preview") && args.length === 2 && commandId(args[1])) return { type: verb, channelId: commandId(args[1])! }
    if (verb === "module" && args.length === 2 && (args[1] === "on" || args[1] === "off")) return { type: "module", enabled: args[1] === "on" }
    const channelId = commandId(args[1])
    if (!channelId) return error
    if (verb === "configure" && args.length === 3 && cleanupAge(args[2]) !== undefined) return { type: "configure", channelId, ageMs: cleanupAge(args[2])! }
    if (verb === "disable" && args.length === 2) return { type: "disable", channelId }
    if (verb === "enable" && (args.length === 2 || args.length === 3 && args[2] === "confirm")) return { type: "enable", channelId, confirmed: args[2] === "confirm" }
    if (verb === "exclude" && args.length === 5 && (args[2] === "author" || args[2] === "message") && (args[3] === "add" || args[3] === "remove") && commandId(args[4])) return { type: "exclude", channelId, kind: args[2], add: args[3] === "add", id: commandId(args[4])! }
    return error
}
