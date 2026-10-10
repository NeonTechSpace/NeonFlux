import type { MemberAccessOperation, ShowcaseOperation } from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type ShowcaseCommand = { type: "help" | "status" | "access" } | { type: "list", authorId?: string } | { type: "change", operation: ShowcaseOperation }

export const showcaseHelp = [
    "!showcase list [@member] | status | help",
    "!showcase on|off | channel #channel|none | limit <1-50>|none | interval <30m, 2h or 1d>|none",
    "!showcase access | access allow|block|unallow|unblock role|user <mentions or IDs>",
    "Members post, edit and delete showcases on the website. Settings need Manage Server",
].join("\n")

/** The access list commands that member features share: access, or access allow|block|unallow|unblock role|user followed by mentions or IDs */
export function parseAccess(args: readonly string[]): { type: "access" } | MemberAccessOperation | undefined {
    if (args.length === 1) return { type: "access" }
    const verb = args[1]?.toLowerCase(), kind = args[2]?.toLowerCase(), ids = args.slice(3).map(commandId)
    if (!(verb === "allow" || verb === "block" || verb === "unallow" || verb === "unblock") || kind !== "role" && kind !== "user" || !ids.length || ids.length > 100 || ids.some(id => id === undefined)) return undefined
    return { type: verb.startsWith("un") ? "access-remove" : "access-add", list: verb.endsWith("allow") ? "allow" : "block", kind, ids: [...new Set(ids as string[])] }
}
/** A duration such as 30m, 2h or 1d in whole minutes, from 1 minute to 7 days */
function minutes(value: string | undefined) {
    const match = /^(\d{1,5})(m|h|d)$/.exec(value?.toLowerCase() ?? ""), count = match ? Number(match[1]) * { m: 1, h: 60, d: 1440 }[match[2] as "m" | "h" | "d"] : 0
    return count >= 1 && count <= 10080 ? count : undefined
}
const change = (operation: ShowcaseOperation): ShowcaseCommand => ({ type: "change", operation })

export function parseShowcaseCommand(args: readonly string[]): ShowcaseCommand | { error: string } {
    const word = (index: number) => args[index]?.toLowerCase()
    if (!args.length || args.length === 1 && word(0) === "status") return { type: "status" }
    if (args.length === 1 && word(0) === "help") return { type: "help" }
    if (args.length === 1 && (word(0) === "on" || word(0) === "off")) return change({ type: "settings", enabled: word(0) === "on" })
    if (word(0) === "list" && args.length <= 2) {
        if (args.length === 1) return { type: "list" }
        const authorId = commandId(args[1])
        return authorId ? { type: "list", authorId } : { error: "Use !showcase list or !showcase list @member" }
    }
    if (word(0) === "channel" && args.length === 2) {
        const channelId = word(1) === "none" ? null : commandId(args[1])
        return channelId === undefined ? { error: "Use !showcase channel #channel or !showcase channel none" } : change({ type: "settings", channelId })
    }
    if (word(0) === "limit" && args.length === 2) {
        const count = /^\d{1,2}$/.test(args[1]!) ? Number(args[1]) : 0
        return word(1) === "none" ? change({ type: "settings", maxPerMember: null }) : count >= 1 && count <= 50 ? change({ type: "settings", maxPerMember: count }) : { error: "Use !showcase limit with 1 to 50 showcases per member, or none" }
    }
    if (word(0) === "interval" && args.length === 2) {
        const count = minutes(args[1])
        return word(1) === "none" ? change({ type: "settings", intervalMinutes: null }) : count ? change({ type: "settings", intervalMinutes: count }) : { error: "Use !showcase interval with a time from 1m to 7d, such as 30m, 2h or 1d, or none" }
    }
    if (word(0) === "access") {
        const access = parseAccess(args)
        return !access ? { error: "Use !showcase access, or access allow|block|unallow|unblock role|user followed by mentions or IDs" } : access.type === "access" ? access : change(access)
    }
    return { error: "Use !showcase help for the showcase commands" }
}
/** Listing showcases and help are for every member. Settings are staff commands */
export const showcasePublic = (command: ShowcaseCommand | { error: string }) => "type" in command && (command.type === "list" || command.type === "help")
