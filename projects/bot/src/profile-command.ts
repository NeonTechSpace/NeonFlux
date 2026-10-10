import type { ProfileOperation } from "@neonflux/contracts/profiles"
import { commandId } from "./moderation-command.ts"
import { parseAccess, type MemberAccessListCommand } from "./showcase-command.ts"

export type ProfileCommand = { type: "show", userId?: string } | { type: "help" | "status" | "access" } | MemberAccessListCommand | { type: "change", operation: ProfileOperation }

export const profileHelp = [
    "!profile [@member]: Your profile, or a member's",
    "!profile status: Whether profiles are on, and their settings",
    "!profile on|off: Turn profiles on or off",
    "!profile cooldown <30s, 5m or 1h>|none: How long a member waits between uses",
    "!profile access | access allowed|blocked [next]: Who may use profiles",
    "!profile access allow|block|unallow|unblock role|user <mentions or IDs>: Change who may use profiles",
    "Members edit their profile on the website",
].join("\n")

/** A cooldown in whole seconds, such as 30, 30s, 5m or 1h, from 1 second to 1 hour */
function seconds(value: string | undefined) {
    const match = /^(\d{1,4})(s|m|h)?$/.exec(value?.toLowerCase() ?? ""), count = match ? Number(match[1]) * { s: 1, m: 60, h: 3600 }[(match[2] ?? "s") as "s" | "m" | "h"] : 0
    return count >= 1 && count <= 3600 ? count : undefined
}
const change = (operation: ProfileOperation): ProfileCommand => ({ type: "change", operation })

export function parseProfileCommand(args: readonly string[]): ProfileCommand | { error: string } {
    const word = (index: number) => args[index]?.toLowerCase()
    if (!args.length) return { type: "show" }
    if (args.length === 1 && (word(0) === "status" || word(0) === "help")) return { type: word(0) as "status" | "help" }
    if (args.length === 1 && (word(0) === "on" || word(0) === "off")) return change({ type: "settings", enabled: word(0) === "on" })
    if (word(0) === "cooldown" && args.length === 2) {
        const count = seconds(args[1])
        return word(1) === "none" ? change({ type: "settings", cooldownSeconds: null }) : count ? change({ type: "settings", cooldownSeconds: count }) : { error: "Use !profile cooldown with 1 second to 1 hour, such as 30s or 5m, or none" }
    }
    if (word(0) === "access") {
        const access = parseAccess(args)
        return !access ? { error: "Use !profile access, access allowed|blocked [next], or access allow|block|unallow|unblock role|user followed by mentions or IDs" }
            : access.type === "access" || access.type === "access-list" ? access : change(access)
    }
    const userId = args.length === 1 ? commandId(args[0]) : undefined
    return userId ? { type: "show", userId } : { error: "Use !profile, !profile @member or !profile help" }
}
/** Showing a profile and help are for every member. Settings are staff commands */
export const profilePublic = (command: ProfileCommand | { error: string }) => "type" in command && (command.type === "show" || command.type === "help")
