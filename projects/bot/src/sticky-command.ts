import { commandId } from "./moderation-command.ts"

export type StickyCommand = { type: "help" } | { type: "list" } | { type: "add", channelId: string, content: string } | { type: "interval", channelId: string, seconds: number } | { type: "remove", channelId: string }

export const stickyHelp = [
    "!sticky add #channel \"text\": Keep this text at the bottom of the channel, or replace its text",
    "!sticky interval #channel <10-3600>: Seconds between reposts in a busy channel, 30 by default",
    "!sticky remove #channel: Stop it and delete its last copy",
    "!sticky list",
    "Up to 5 channels. Server owner, Administrator or Manage Server",
].join("\n")

export function parseStickyCommand(args: readonly string[]): StickyCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), channelId = commandId(args[1])
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "add" && channelId && args.length >= 3) {
        const content = args.slice(2).join(" ")
        return content.trim() && content.length <= 2000 ? { type: "add", channelId, content } : { error: "Sticky text needs 1 to 2000 characters" }
    }
    if (verb === "interval" && channelId && args.length === 3) {
        const seconds = /^\d{1,4}$/.test(args[2]!) ? Number(args[2]) : 0
        return seconds >= 10 && seconds <= 3600 ? { type: "interval", channelId, seconds } : { error: "Sticky intervals are 10 to 3600 seconds" }
    }
    if (verb === "remove" && channelId && args.length === 2) return { type: "remove", channelId }
    return { error: "Check the sticky command syntax. Use !sticky help" }
}
