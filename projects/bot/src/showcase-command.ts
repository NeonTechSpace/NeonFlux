import type { MemberAccessOperation } from "@neonflux/contracts/shared"
import type { ShowcaseOperation } from "@neonflux/contracts/showcases"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, durationSeconds } from "./command-arguments.ts"
import type { MemberAccessListCommand } from "./rolepicker-command.ts"

export type ShowcaseCommand =
    | { type: "help" | "status" | "access" }
    | MemberAccessListCommand
    | { type: "list"; authorId?: string }
    | { type: "change"; operation: ShowcaseOperation }

export const showcaseHelp = [
    "!showcase list [@member]: Showcases, or one member's",
    "!showcase: Whether showcases are on, and their settings",
    "!showcase on|off: Turn showcases on or off",
    "!showcase channel #channel|none: Where showcases are posted",
    "!showcase limit <1-50>|none: Showcases each member may have",
    "!showcase interval <30m, 2h or 1d>|none: How long a member waits between posts",
    "!showcase access | access allowed|blocked [next]: Who may post",
    "!showcase access allow|block|unallow|unblock role|user <mentions or IDs>: Change who may post",
    "Members post, edit and delete their showcases on the website",
].join("\n")

/** The access list commands that member features share: access, access allowed|blocked [next], or access allow|block|unallow|unblock role|user followed by mentions or IDs */
export function parseAccess(
    args: readonly string[],
): { type: "access" } | MemberAccessListCommand | MemberAccessOperation | undefined {
    if (args.length === 1) return { type: "access" }
    const verb = args[1]?.toLowerCase(),
        kind = args[2]?.toLowerCase(),
        ids = args.slice(3).map((id) => commands.parseArgument(id, kind === "role" ? argument.role : argument.user))
    if ((verb === "allowed" || verb === "blocked") && (args.length === 2 || (args.length === 3 && kind === "next")))
        return { type: "access-list", list: verb === "allowed" ? "allow" : "block", next: args.length === 3 }
    if (
        !(verb === "allow" || verb === "block" || verb === "unallow" || verb === "unblock") ||
        (kind !== "role" && kind !== "user") ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => id === undefined)
    )
        return undefined
    return {
        type: verb.startsWith("un") ? "access-remove" : "access-add",
        list: verb.endsWith("allow") ? "allow" : "block",
        kind,
        ids: [...new Set(ids as string[])],
    }
}
/** A duration such as 30m, 2h or 1d in whole minutes, from 1 minute to 7 days */
function minutes(value: string | undefined) {
    const seconds = durationSeconds(value, 60, 10080 * 60)
    return seconds !== undefined && seconds % 60 === 0 ? seconds / 60 : undefined
}
const change = (operation: ShowcaseOperation): ShowcaseCommand => ({ type: "change", operation })

export function parseShowcaseCommand(args: readonly string[]): ShowcaseCommand | { error: string } {
    const word = (index: number) => args[index]?.toLowerCase()
    if (!args.length || (args.length === 1 && word(0) === "status")) return { type: "status" }
    if (args.length === 1 && word(0) === "help") return { type: "help" }
    if (args.length === 1 && (word(0) === "on" || word(0) === "off"))
        return change({ type: "settings", enabled: word(0) === "on" })
    if (word(0) === "list" && args.length <= 2) {
        if (args.length === 1) return { type: "list" }
        const authorId = commands.parseArgument(args[1], argument.user)
        return authorId ? { type: "list", authorId } : { error: "Use !showcase list or !showcase list @member" }
    }
    if (word(0) === "channel" && args.length === 2) {
        const channelId = word(1) === "none" ? null : commands.parseArgument(args[1], argument.channel)
        return channelId === undefined
            ? { error: "Use !showcase channel #channel or !showcase channel none" }
            : change({ type: "settings", channelId })
    }
    if (word(0) === "limit" && args.length === 2) {
        const count = commands.parseArgument(args[1], { type: "integer", min: 1, max: 50 })
        return word(1) === "none"
            ? change({ type: "settings", maxPerMember: null })
            : count
              ? change({ type: "settings", maxPerMember: count })
              : { error: "Use !showcase limit with 1 to 50 showcases per member, or none" }
    }
    if (word(0) === "interval" && args.length === 2) {
        const count = minutes(args[1])
        return word(1) === "none"
            ? change({ type: "settings", intervalMinutes: null })
            : count
              ? change({ type: "settings", intervalMinutes: count })
              : { error: "Use !showcase interval with a time from 1m to 7d, such as 30m, 2h or 1d, or none" }
    }
    if (word(0) === "access") {
        const access = parseAccess(args)
        return !access
            ? {
                  error: "Use !showcase access, access allowed|blocked [next], or access allow|block|unallow|unblock role|user followed by mentions or IDs",
              }
            : access.type === "access" || access.type === "access-list"
              ? access
              : change(access)
    }
    return { error: "Use !showcase help for the showcase commands" }
}
/** Listing showcases and help are for every member. Settings are staff commands */
export const showcasePublic = (command: ShowcaseCommand | { error: string }) =>
    "type" in command && (command.type === "list" || command.type === "help")
