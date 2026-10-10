import { TEMPORARY_ROLE_MAX_SECONDS, TEMPORARY_ROLE_MIN_SECONDS } from "@neonflux/contracts/temporary-roles"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, durationSeconds } from "./command-arguments.ts"

export type TemporaryRoleCommand =
    | { type: "help" }
    | { type: "defaults"; next?: true }
    | { type: "add"; userId: string; roleId: string; seconds?: number }
    | { type: "set"; userId: string; roleId: string; seconds: number }
    | { type: "remove"; userId: string; roleId: string }
    | { type: "list"; userId?: string; next?: true }
    | { type: "default"; roleId: string; seconds: number | null }
    | { type: "max"; roleId: string; seconds: number | null }
    | { type: "reconcile"; userId: string }

export const temporaryRoleHelp = [
    "!temprole add @member @role [duration]: Give a role for a time, such as 30m, 12h, 7d or 2w",
    "!temprole set @member @role <duration>: Renew or shorten it, counted from now",
    "!temprole remove @member @role: End it early and remove the role",
    "!temprole list [@member] [next]: Temporary roles, ending soonest first",
    "!temprole defaults [next]: Each role's default and longest time",
    "!temprole default|max @role <duration>|none: Set a role's default or longest time",
    "!temprole reconcile @member: Check a role change that was not confirmed, for Administrators",
].join("\n")

/** A duration such as 30m, 12h, 7d, 2w or 1d12h in seconds, from 1 minute to 365 days */
export function temporaryDuration(value: string | undefined) {
    return durationSeconds(value, TEMPORARY_ROLE_MIN_SECONDS, TEMPORARY_ROLE_MAX_SECONDS)
}
export function parseTemporaryRoleCommand(args: readonly string[]): TemporaryRoleCommand | { error: string } {
    const verb = args[0]?.toLowerCase(),
        userId = commands.parseArgument(args[1], argument.user),
        roleId = commands.parseArgument(args[2], argument.role)
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "defaults" && (args.length === 1 || (args.length === 2 && args[1]!.toLowerCase() === "next")))
        return { type: "defaults", ...(args.length === 2 ? { next: true } : {}) }
    if (verb === "add" && userId && roleId && args.length <= 4) {
        if (args.length === 3) return { type: "add", userId, roleId }
        const seconds = temporaryDuration(args[3])
        if (seconds) return { type: "add", userId, roleId, seconds }
    }
    if (verb === "set" && userId && roleId && args.length === 4 && temporaryDuration(args[3]))
        return { type: "set", userId, roleId, seconds: temporaryDuration(args[3])! }
    if (verb === "remove" && userId && roleId && args.length === 3) return { type: "remove", userId, roleId }
    if (verb === "list" && args.length <= 3) {
        const next = args.at(-1) === "next",
            member = args.length - (next ? 2 : 1)
        if (member === 0 || (member === 1 && userId))
            return { type: "list", ...(member ? { userId: userId! } : {}), ...(next ? { next: true } : {}) }
    }
    if ((verb === "default" || verb === "max") && args.length === 3) {
        const target = commands.parseArgument(args[1], argument.role),
            none = args[2]!.toLowerCase() === "none",
            seconds = temporaryDuration(args[2])
        if (target && (none || seconds))
            return { type: verb === "default" ? "default" : "max", roleId: target, seconds: none ? null : seconds! }
    }
    if (verb === "reconcile" && userId && args.length === 2) return { type: "reconcile", userId }
    return {
        error: "Check the member, role and duration, such as !temprole add @member @role 7d. Use !temprole help for every form",
    }
}
/** Ending, listing and recovery stay available to administrators at DEFCON 1 */
export function temporaryRoleCritical(command: TemporaryRoleCommand | { error: string }) {
    return "type" in command && ["help", "defaults", "list", "remove", "reconcile"].includes(command.type)
}
