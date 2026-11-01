import { commands } from "@neontechspace/fluxerly/effect"
import { hasText } from "@neonflux/contracts/common"
import { argument, freeText } from "./command-arguments.ts"

export type LockdownCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "on" | "off"; reason?: string }
    | { type: "exempt"; channelId: string; exempt: boolean }
    | { type: "exempt-list"; next?: true }

export const lockdownHelp = [
    "!lockdown on [reason]: Stop posting in every text, announcement, forum and voice channel the everyone role can see",
    "!lockdown off [reason]: Give every channel back what it had, except what changed since",
    "!lockdown status: How many channels are locked, failed or uncertain, and names up to 10 problem channels",
    "!lockdown exempt add|remove #channel: Leave a channel out of the next lockdown",
    "!lockdown exempt list [next]: The channels a lockdown leaves out",
    "A channel locked with !security lock stays locked after !lockdown off. A channel created during a lockdown is not touched",
    "Before a raid, exempt staff channels that a role without staff permissions can see, since a lockdown counts those as public",
].join("\n")

const syntax = { error: "Check the lockdown command syntax. Use !lockdown help" }
export function parseLockdownCommand(args: readonly string[]): LockdownCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "on" || verb === "off") {
        const text = freeText(args, 1)
        if (!hasText(text)) return { type: verb }
        return text.length > 512 ? syntax : { type: verb, reason: text }
    }
    if (verb === "exempt") {
        const action = args[1]?.toLowerCase()
        if (action === "list" && (args.length === 2 || (args.length === 3 && args[2] === "next")))
            return { type: "exempt-list", ...(args[2] ? { next: true as const } : {}) }
        if ((action === "add" || action === "remove") && args.length === 3) {
            const channelId = commands.parseArgument(args[2], argument.channel)
            return channelId ? { type: "exempt", channelId, exempt: action === "add" } : syntax
        }
    }
    return syntax
}
/** Lifting a lockdown and reading its state stay reachable for an Administrator at DEFCON 1 */
export const lockdownCritical = (command: LockdownCommand | { error: string }) =>
    "type" in command && (command.type === "off" || command.type === "status")
