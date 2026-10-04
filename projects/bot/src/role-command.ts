import { commandId } from "./moderation-command.ts"

export type RoleCommandName = "roles" | "verify" | "autorole"
export type RoleCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "jobs" }
    | { type: "reactions", name: string }
    | { type: "resume", jobId: string }
    | { type: "module", enabled: boolean }
    | { type: "humans", humansOnly: boolean }
    | { type: "mode", name: string, exclusive: boolean }
    | { type: "withdrawal", withdrawalId: string }
    | { type: "retire", name?: string, revision?: number }
    | { type: "history", name?: string, cursor?: string }
    | { type: "create", name: string, mode: "toggle" | "exclusive" }
    | { type: "list", page: number }
    | { type: "show" | "enable" | "disable" | "delete", name: string }
    | { type: "mapping", name: string, emoji: string, roleId: string }
    | { type: "unmap", name: string, emoji: string }
    | { type: "scope", name: string, emoji: string, field: "prerequisites" | "exclusions", roleIds: string[] }
    | { type: "publish", name?: string, channelId: string, draftName: string }
    | { type: "choose", name: string, emoji: string | null }
    | { type: "configure", roleId: string, emoji: string }
    | { type: "verify" }
    | { type: "autorole", operation: "add" | "remove", roleId: string }
    | { type: "reservation", userId: string, roleIds: string[] }
    | { type: "reservations" }
    | { type: "member", operation: "reconcile" | "withdraw", name?: string, userId?: string, cursor?: string }

const nameValue = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : undefined
const pageValue = (value: string | undefined) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
const scopes = (args: readonly string[]) => {
    if (args.length === 1 && args[0] === "none") return []
    const ids = args.map(commandId)
    return ids.length > 0 && ids.length <= 20 && ids.every((id) => id !== undefined) ? [...new Set(ids as string[])] : undefined
}

export function roleHelp(name: RoleCommandName) {
    const shared = `!${name} status | module on|off | help`
    if (name === "verify") return [
        "!verify acknowledges the current rules and requests the configured access role",
        "!verify configure @role <emoji> | publish #channel <draft-name>",
        "!verify reconcile [@user] [cursor] | withdraw [@user] [cursor] (Administrator recovery)",
        "!verify retire [published-revision] | next <withdrawal-id>", shared,
    ].join("\n")
    if (name === "autorole") return [
        "!autorole add|remove @role | list | humans on|off",
        "!autorole reserve <user-id> @roles... | unreserve <user-id> | reservations",
        "!autorole retire [settings-revision] | next <withdrawal-id>",
        "!autorole reconcile|withdraw @user [cursor] (Administrator recovery) | history [cursor]", shared,
    ].join("\n")
    return [
        "!roles create <name> toggle|exclusive | show|enable|disable|delete <name> | list [page]",
        "!roles map <name> <emoji> @role | unmap <name> <emoji>",
        "!roles requires|excludes <name> <emoji> @roles...|none",
        "!roles publish <name> #channel <draft-name>",
        "!roles choose <name> <emoji>|none | reconcile|withdraw <name> [@user] [cursor]", shared,
        "!roles history <name> [cursor]",
        "!roles reactions <name> | jobs | resume <job-id>",
        "!roles mode <name> toggle|exclusive | retire <name> [published-revision] | next <withdrawal-id>",
        "Use !publish to compose panel drafts. Changed mappings or rules require a fresh panel message",
        "Withdrawal is administrator recovery. Public opt-out uses choose or reactions while the module and panel are enabled",
    ].join("\n")
}

export function parseRoleCommand(name: RoleCommandName, args: readonly string[]): RoleCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    const error = { error: `Check quoting and values. Use !${name} help for examples` }
    if (!verb) return name === "verify" ? { type: "verify" } : { type: "help" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "jobs" && args.length === 1) return { type: "jobs" }
    if (verb === "resume" && args.length === 2 && /^[a-zA-Z0-9_-]{1,128}$/.test(args[1]!)) return { type: "resume", jobId: args[1]! }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", enabled: args[1] === "on" }
    if (verb === "next" && args.length === 2 && /^[a-zA-Z0-9_-]{1,128}$/.test(args[1]!)) return { type: "withdrawal", withdrawalId: args[1]! }
    if (verb === "list" && args.length <= 2 && (!args[1] || pageValue(args[1]))) return { type: "list", page: pageValue(args[1]) ?? 1 }
    if (name === "autorole") {
        if (verb === "reservations" && args.length === 1) return { type: "reservations" }
        if (verb === "unreserve" && args.length === 2 && commandId(args[1])) return { type: "reservation", userId: commandId(args[1])!, roleIds: [] }
        if (verb === "reserve" && args.length >= 3 && commandId(args[1])) {
            const roleIds = scopes(args.slice(2))
            if (roleIds?.length) return { type: "reservation", userId: commandId(args[1])!, roleIds }
        }
        if (verb === "history" && args.length <= 2) return { type: "history", ...(args[1] ? { cursor: args[1] } : {}) }
        if (verb === "humans" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "humans", humansOnly: args[1] === "on" }
        if (verb === "retire" && args.length <= 2 && (!args[1] || pageValue(args[1]))) return { type: "retire", ...(args[1] ? { revision: pageValue(args[1])! } : {}) }
        const roleId = commandId(args[1])
        if ((verb === "add" || verb === "remove") && args.length === 2 && roleId) return { type: "autorole", operation: verb, roleId }
        if ((verb === "reconcile" || verb === "withdraw") && args.length >= 2 && args.length <= 3 && roleId) return { type: "member", operation: verb, userId: roleId, ...(args[2] ? { cursor: args[2] } : {}) }
        return error
    }
    if (name === "verify") {
        if (verb === "retire" && args.length <= 2 && (!args[1] || pageValue(args[1]))) return { type: "retire", name: "rules", ...(args[1] ? { revision: pageValue(args[1])! } : {}) }
        if (verb === "configure" && args.length === 3 && commandId(args[1])) return { type: "configure", roleId: commandId(args[1])!, emoji: args[2]! }
        if (verb === "publish" && args.length === 3 && commandId(args[1]) && nameValue(args[2])) return { type: "publish", channelId: commandId(args[1])!, draftName: nameValue(args[2])! }
        if ((verb === "reconcile" || verb === "withdraw") && args.length <= 3 && (!args[1] || commandId(args[1]))) return { type: "member", operation: verb, ...(args[1] ? { userId: commandId(args[1])! } : {}), ...(args[2] ? { cursor: args[2] } : {}) }
        return error
    }
    const panel = nameValue(args[1])
    if (!panel) return error
    if (verb === "reactions" && args.length === 2) return { type: "reactions", name: panel }
    if (verb === "history" && args.length <= 3) return { type: "history", name: panel, ...(args[2] ? { cursor: args[2] } : {}) }
    if (verb === "create" && args.length === 3 && ["toggle", "exclusive"].includes(args[2]!)) return { type: "create", name: panel, mode: args[2] as "toggle" | "exclusive" }
    if (verb === "mode" && args.length === 3 && ["toggle", "exclusive"].includes(args[2]!)) return { type: "mode", name: panel, exclusive: args[2] === "exclusive" }
    if (verb === "retire" && args.length <= 3 && (!args[2] || pageValue(args[2]))) return { type: "retire", name: panel, ...(args[2] ? { revision: pageValue(args[2])! } : {}) }
    if (["show", "enable", "disable", "delete"].includes(verb) && args.length === 2) return { type: verb as "show" | "enable" | "disable" | "delete", name: panel }
    if (verb === "map" && args.length === 4 && commandId(args[3])) return { type: "mapping", name: panel, emoji: args[2]!, roleId: commandId(args[3])! }
    if (verb === "unmap" && args.length === 3) return { type: "unmap", name: panel, emoji: args[2]! }
    if ((verb === "requires" || verb === "excludes") && args.length >= 4) {
        const roleIds = scopes(args.slice(3))
        if (roleIds) return { type: "scope", name: panel, emoji: args[2]!, field: verb === "requires" ? "prerequisites" : "exclusions", roleIds }
    }
    if (verb === "publish" && args.length === 4 && commandId(args[2]) && nameValue(args[3])) return { type: "publish", name: panel, channelId: commandId(args[2])!, draftName: nameValue(args[3])! }
    if (verb === "choose" && args.length === 3) return { type: "choose", name: panel, emoji: args[2] === "none" ? null : args[2]! }
    if ((verb === "reconcile" || verb === "withdraw") && args.length <= 4 && (!args[2] || commandId(args[2]))) return { type: "member", operation: verb, name: panel, ...(args[2] ? { userId: commandId(args[2])! } : {}), ...(args[3] ? { cursor: args[3] } : {}) }
    return error
}
