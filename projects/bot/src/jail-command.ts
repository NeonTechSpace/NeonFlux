import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export type JailCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "list"; next?: true }
    | { type: "setup"; channelId?: string }
    | { type: "role"; roleId: string }
    | { type: "channel"; channelId: string }
    | { type: "module"; enabled: boolean }

export const jailHelp = [
    "!jail setup [#channel]: Make the jail role and channel, and deny the role every other channel, for the owner or an Administrator",
    "!jail role @role: Use a role you already have as the jail role",
    "!jail channel #channel: Use a channel you already have as the jail channel",
    "!jail status: Whether jail is on, how far setup got and the channels it could not change",
    "!jail list [next]: Who is jailed, and until when",
    "!jail module on|off: Turn new jails on or off. Members already jailed stay jailed",
    "!mod jail @member [length] [reason]: Take a member's roles and keep them in the jail channel",
    "!mod unjail @member [reason]: Give the member's roles back",
].join("\n")

/** What a jailed member may still run, since anything else could carry their text out of the jail channel or hand them a room */
export const JAILED_COMMANDS: ReadonlySet<string> = new Set(["help", "ping", "appeal", "mydata", "ticket"])
export const jailedRefusal = "You are jailed, so only !help, !ping, !appeal, !mydata and !ticket work"

const syntax = { error: "Check the jail command syntax. Use !jail help" }
export function parseJailCommand(args: readonly string[]): JailCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && (args.length === 1 || (args.length === 2 && args[1] === "next")))
        return { type: "list", ...(args[1] ? { next: true as const } : {}) }
    if (verb === "module" && args.length === 2 && (args[1] === "on" || args[1] === "off"))
        return { type: "module", enabled: args[1] === "on" }
    if (verb === "setup" && args.length <= 2) {
        if (args.length === 1) return { type: "setup" }
        const channelId = commands.parseArgument(args[1], argument.channel)
        return channelId ? { type: "setup", channelId } : syntax
    }
    if (verb === "role" && args.length === 2) {
        const roleId = commands.parseArgument(args[1], argument.role)
        return roleId ? { type: "role", roleId } : syntax
    }
    if (verb === "channel" && args.length === 2) {
        const channelId = commands.parseArgument(args[1], argument.channel)
        return channelId ? { type: "channel", channelId } : syntax
    }
    return syntax
}
/** Reading jail and turning it off stay reachable for an Administrator at DEFCON 1 */
export const jailCritical = (command: JailCommand | { error: string }) =>
    "type" in command &&
    (command.type === "status" || command.type === "list" || (command.type === "module" && !command.enabled))
