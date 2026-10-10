import { commandId } from "./moderation-command.ts"

export type CleanupCommand =
    | { type: "help" }
    | { type: "list", next: boolean }
    | { type: "status", channelId?: string }
    | { type: "messages", channelId: string, next: boolean }
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
    "!cleanup configure #channel <age>: Delete messages older than an age, from 1h to 365d",
    "!cleanup preview #channel: Check what would be deleted, deleting nothing",
    "!cleanup enable #channel [confirm]: Start deleting there, old messages included",
    "!cleanup disable #channel: Stop deleting there",
    "!cleanup list [next]: Channels with cleanup",
    "!cleanup status [#channel]: Whether cleanup is on, or one channel's last run",
    "!cleanup module on|off: Turn message cleanup on or off",
    "Send !cleanup help all for the other commands",
].join("\n")
/** The forms !cleanup help leaves out, listed by !cleanup help all */
export const cleanupHelpAll = [
    "!cleanup show #channel: A channel's cleanup settings",
    "!cleanup status #channel messages [next]: The messages it handled, newest first",
    "!cleanup exclude #channel author|message add|remove <id>: Never delete an author's messages or one message",
]
export function cleanupCritical(command: CleanupCommand | { error: string }) {
    return !("error" in command) && (["show", "list", "status", "messages", "preview", "disable"].includes(command.type)
        || command.type === "module" && !command.enabled)
}
export function parseCleanupCommand(args: readonly string[]): CleanupCommand | { error: string } {
    const error = { error: "Check the channel, IDs and age. Use !cleanup help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb && !args.length || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "list", next: args[1] === "next" }
    if (verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "status" && args.length === 2 && commandId(args[1])) return { type: "status", channelId: commandId(args[1])! }
    if (verb === "status" && commandId(args[1]) && args[2] === "messages" && (args.length === 3 || args.length === 4 && args[3] === "next")) return { type: "messages", channelId: commandId(args[1])!, next: args[3] === "next" }
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
