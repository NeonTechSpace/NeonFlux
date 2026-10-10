import { commandId } from "./moderation-command.ts"

export type TemporaryRoleCommand =
    | { type: "help" }
    | { type: "defaults", next?: true }
    | { type: "add", userId: string, roleId: string, seconds?: number }
    | { type: "set", userId: string, roleId: string, seconds: number }
    | { type: "remove", userId: string, roleId: string }
    | { type: "list", userId?: string, next?: true }
    | { type: "default", roleId: string, seconds: number | null }
    | { type: "max", roleId: string, seconds: number | null }
    | { type: "reconcile", userId: string }

export const temporaryRoleHelp = [
    "!temprole add @member @role [duration]: Give a role for a time, such as 30m, 12h, 7d or 2w",
    "!temprole set @member @role <duration>: Renew or shorten it, counted from now",
    "!temprole remove @member @role: End it early and remove the role",
    "!temprole list [@member] [next]: Temporary roles, ending soonest first",
    "!temprole defaults [next]: Each role's default and longest time",
    "!temprole default|max @role <duration>|none: Set a role's default or longest time",
    "!temprole reconcile @member: Check a role change that was not confirmed, for Administrators",
].join("\n")

const units = { m: 60, h: 3600, d: 86400, w: 604800 } as const
/** A duration such as 30m, 12h, 7d or 2w in seconds, from 1 minute to 365 days */
export function temporaryDuration(value: string | undefined) {
    const match = /^(\d{1,6})([mhdw])$/i.exec(value ?? "")
    const seconds = match ? Number(match[1]) * units[match[2]!.toLowerCase() as keyof typeof units] : 0
    return seconds >= 60 && seconds <= 365 * 86400 ? seconds : undefined
}
export function parseTemporaryRoleCommand(args: readonly string[]): TemporaryRoleCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), userId = commandId(args[1]), roleId = commandId(args[2])
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "defaults" && (args.length === 1 || args.length === 2 && args[1]!.toLowerCase() === "next")) return { type: "defaults", ...(args.length === 2 ? { next: true } : {}) }
    if (verb === "add" && userId && roleId && args.length <= 4) {
        if (args.length === 3) return { type: "add", userId, roleId }
        const seconds = temporaryDuration(args[3])
        if (seconds) return { type: "add", userId, roleId, seconds }
    }
    if (verb === "set" && userId && roleId && args.length === 4 && temporaryDuration(args[3])) return { type: "set", userId, roleId, seconds: temporaryDuration(args[3])! }
    if (verb === "remove" && userId && roleId && args.length === 3) return { type: "remove", userId, roleId }
    if (verb === "list" && args.length <= 3) {
        const next = args.at(-1) === "next", member = args.length - (next ? 2 : 1)
        if (member === 0 || member === 1 && userId) return { type: "list", ...(member ? { userId: userId! } : {}), ...(next ? { next: true } : {}) }
    }
    if ((verb === "default" || verb === "max") && args.length === 3) {
        const target = commandId(args[1]), none = args[2]!.toLowerCase() === "none", seconds = temporaryDuration(args[2])
        if (target && (none || seconds)) return { type: verb === "default" ? "default" : "max", roleId: target, seconds: none ? null : seconds! }
    }
    if (verb === "reconcile" && userId && args.length === 2) return { type: "reconcile", userId }
    return { error: "Check the member, role and duration, such as !temprole add @member @role 7d. Use !temprole help for every form" }
}
/** Ending, listing and recovery stay available to administrators at DEFCON 1 */
export function temporaryRoleCritical(command: TemporaryRoleCommand | { error: string }) {
    return "type" in command && ["help", "defaults", "list", "remove", "reconcile"].includes(command.type)
}
