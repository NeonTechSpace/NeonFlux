import { commandId } from "./moderation-command.ts"

export type RoleCommandName = "roles" | "verify" | "autorole"
export type RoleCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "jobs" }
    | { type: "reactions", name: string }
    | { type: "resume", name: string }
    | { type: "module", enabled: boolean }
    | { type: "humans", humansOnly: boolean }
    | { type: "mode", name: string, exclusive: boolean }
    | { type: "withdrawal", name?: string }
    | { type: "retire", name?: string }
    | { type: "history", name?: string, next?: true }
    | { type: "create", name: string, mode: "toggle" | "exclusive" }
    | { type: "list", next?: true }
    | { type: "show" | "enable" | "disable" | "delete", name: string }
    | { type: "mapping", name: string, emoji: string, roleId: string }
    | { type: "unmap", name: string, emoji: string }
    | { type: "scope", name: string, emoji: string, field: "prerequisites" | "exclusions", roleIds: string[] }
    | { type: "publish", name?: string, channelId: string, draftName: string }
    | { type: "choose", name: string, emoji: string | null }
    | { type: "configure", roleId: string, emoji: string }
    | { type: "verify" }
    | { type: "verification-review", challengeId: string }
    | { type: "autorole", operation: "add" | "remove", roleId: string }
    | { type: "reservation", userId: string, roleIds: string[] }
    | { type: "reservations", next?: true }
    | { type: "member", operation: "reconcile" | "withdraw", name?: string, userId?: string, next?: true }

const nameValue = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : undefined
/** An optional member and then an optional next, which continues the last page of that member's claims */
const memberPage = (rest: readonly string[]) => {
    const next = rest.at(-1) === "next", user = rest.slice(0, next ? -1 : undefined)
    return user.length > 1 || user[0] && !commandId(user[0]) ? undefined : { ...(user[0] ? { userId: commandId(user[0])! } : {}), ...(next ? { next: true as const } : {}) }
}
const scopes = (args: readonly string[]) => {
    if (args.length === 1 && args[0] === "none") return []
    const ids = args.map(commandId)
    return ids.length > 0 && ids.length <= 20 && ids.every((id) => id !== undefined) ? [...new Set(ids as string[])] : undefined
}

export function roleHelp(name: RoleCommandName) {
    if (name === "verify") return [
        "!verify: Accept the server rules to get access",
        "!verify status: Whether your acceptance was saved and you have the access role",
        "!verify configure @role <emoji>: The access role and the rules panel's reaction",
        "!verify publish #channel <draft-name>: Post the rules panel, written with !publish",
        "!verify module on|off: Turn rules verification on or off",
        "!verify review <reference>: Help a member who cannot finish the web check, for Administrators",
        "!verify reconcile|withdraw [@user] [next]: Check or take back members' access roles, for Administrators",
        "!verify retire | next: Retire the rules panel and take back its roles, or continue if that stopped",
    ].join("\n")
    if (name === "autorole") return [
        "!autorole add|remove @role: Give new members a role, or stop",
        "!autorole list: The roles new members get",
        "!autorole humans on|off: Give the roles to people only, or to bots too",
        "!autorole reserve <user-id> @roles: Roles a user gets when they join or rejoin",
        "!autorole reservations [next]: The users with reserved roles",
        "!autorole module on|off: Turn autorole on or off",
        "Send !autorole help all for the other commands",
    ].join("\n")
    return [
        "!roles create <name> toggle|exclusive: Start a panel. Exclusive allows one choice",
        "!roles map <name> <emoji> @role: Give a role for a reaction",
        "!roles publish <name> #channel <draft-name>: Post the panel, written with !publish",
        "!roles list [next]: The panels",
        "!roles choose <name> <emoji>|none: Pick a role without reacting, or none to clear it",
        "!roles module on|off: Turn reaction roles on or off",
        "Send !roles help all for the other commands",
    ].join("\n")
}
/** The forms !roles help and !autorole help leave out, listed by help all */
export const roleHelpAll = {
    roles: [
        "!roles show|enable|disable|delete <name>: Show a panel, turn it on or off, or delete it",
        "!roles unmap <name> <emoji>: Remove a reaction's role",
        "!roles requires|excludes <name> <emoji> @roles|none: Roles a member must have, or must not have",
        "!roles mode <name> toggle|exclusive: Allow any combination or one choice",
        "!roles status: Whether reaction roles are on and how the panels are doing",
        "!roles retire|next <name>: Retire a published panel and take back its roles, or continue if that stopped",
        "!roles history <name> [next]: A panel's role changes",
        "!roles reactions|resume <name> | jobs: Recheck a panel's reactions after they were cleared",
        "!roles reconcile|withdraw <name> [@user] [next]: Check or take back members' panel roles, for Administrators",
    ],
    autorole: [
        "!autorole unreserve <user-id>: Remove a user's reserved roles",
        "!autorole status: Whether autorole is on and its settings",
        "!autorole history [next]: Recent autorole role changes",
        "!autorole retire | next: Take back the roles autorole gave, or continue if that stopped",
        "!autorole reconcile|withdraw @user [next]: Check or take back a member's autorole roles, for Administrators",
    ],
} as const

export function parseRoleCommand(name: RoleCommandName, args: readonly string[]): RoleCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    const error = { error: `Check quoting and values. Use !${name} help for examples` }
    if (!verb) return name === "verify" ? { type: "verify" } : { type: "help" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "jobs" && args.length === 1) return { type: "jobs" }
    if (verb === "resume" && args.length === 2 && nameValue(args[1])) return { type: "resume", name: nameValue(args[1])! }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", enabled: args[1] === "on" }
    if (verb === "list" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "list", ...(args[1] ? { next: true } : {}) }
    if (name === "autorole") {
        if (verb === "reservations" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "reservations", ...(args[1] ? { next: true } : {}) }
        // next continues the newest unfinished role removal of autorole or the rules panel, or of the reaction panel it names
        if (verb === "next" && args.length === 1) return { type: "withdrawal" }
        if (verb === "unreserve" && args.length === 2 && commandId(args[1])) return { type: "reservation", userId: commandId(args[1])!, roleIds: [] }
        if (verb === "reserve" && args.length >= 3 && commandId(args[1])) {
            const roleIds = scopes(args.slice(2))
            if (roleIds?.length) return { type: "reservation", userId: commandId(args[1])!, roleIds }
        }
        if (verb === "history" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "history", ...(args[1] ? { next: true } : {}) }
        if (verb === "humans" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "humans", humansOnly: args[1] === "on" }
        if (verb === "retire" && args.length === 1) return { type: "retire" }
        const roleId = commandId(args[1]), member = memberPage(args.slice(1))
        if ((verb === "add" || verb === "remove") && args.length === 2 && roleId) return { type: "autorole", operation: verb, roleId }
        if ((verb === "reconcile" || verb === "withdraw") && member?.userId) return { type: "member", operation: verb, ...member }
        return error
    }
    if (name === "verify") {
        const member = memberPage(args.slice(1))
        if (verb === "review" && args.length === 2 && /^[a-zA-Z0-9_-]{1,128}$/.test(args[1]!)) return { type: "verification-review", challengeId: args[1]! }
        if (verb === "retire" && args.length === 1) return { type: "retire", name: "rules" }
        if (verb === "next" && args.length === 1) return { type: "withdrawal", name: "rules" }
        if (verb === "configure" && args.length === 3 && commandId(args[1])) return { type: "configure", roleId: commandId(args[1])!, emoji: args[2]! }
        if (verb === "publish" && args.length === 3 && commandId(args[1]) && nameValue(args[2])) return { type: "publish", channelId: commandId(args[1])!, draftName: nameValue(args[2])! }
        if ((verb === "reconcile" || verb === "withdraw") && member) return { type: "member", operation: verb, ...member }
        return error
    }
    const panel = nameValue(args[1]), member = memberPage(args.slice(2))
    if (!panel) return error
    if (verb === "reactions" && args.length === 2) return { type: "reactions", name: panel }
    if (verb === "history" && (args.length === 2 || args.length === 3 && args[2] === "next")) return { type: "history", name: panel, ...(args[2] ? { next: true } : {}) }
    if (verb === "create" && args.length === 3 && ["toggle", "exclusive"].includes(args[2]!)) return { type: "create", name: panel, mode: args[2] as "toggle" | "exclusive" }
    if (verb === "mode" && args.length === 3 && ["toggle", "exclusive"].includes(args[2]!)) return { type: "mode", name: panel, exclusive: args[2] === "exclusive" }
    if (verb === "retire" && args.length === 2) return { type: "retire", name: panel }
    if (verb === "next" && args.length === 2) return { type: "withdrawal", name: panel }
    if (["show", "enable", "disable", "delete"].includes(verb) && args.length === 2) return { type: verb as "show" | "enable" | "disable" | "delete", name: panel }
    if (verb === "map" && args.length === 4 && commandId(args[3])) return { type: "mapping", name: panel, emoji: args[2]!, roleId: commandId(args[3])! }
    if (verb === "unmap" && args.length === 3) return { type: "unmap", name: panel, emoji: args[2]! }
    if ((verb === "requires" || verb === "excludes") && args.length >= 4) {
        const roleIds = scopes(args.slice(3))
        if (roleIds) return { type: "scope", name: panel, emoji: args[2]!, field: verb === "requires" ? "prerequisites" : "exclusions", roleIds }
    }
    if (verb === "publish" && args.length === 4 && commandId(args[2]) && nameValue(args[3])) return { type: "publish", name: panel, channelId: commandId(args[2])!, draftName: nameValue(args[3])! }
    if (verb === "choose" && args.length === 3) return { type: "choose", name: panel, emoji: args[2] === "none" ? null : args[2]! }
    if ((verb === "reconcile" || verb === "withdraw") && member) return { type: "member", operation: verb, name: panel, ...member }
    return error
}
