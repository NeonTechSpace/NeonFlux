import type { RolePickerOperation } from "@neonflux/contracts/role-picker"
import { commandId } from "./moderation-command.ts"
import type { MemberAccessListCommand } from "./showcase-command.ts"

export type RolePickerCommand = { type: "help" | "status" | "list" | "access" } | { type: "menu", name: string, next: boolean } | MemberAccessListCommand | { type: "change", operation: RolePickerOperation }

export const rolePickerHelp = [
    "!rolepicker: Whether the role picker is on, and its menus",
    "!rolepicker on|off: Turn the role picker on or off",
    "!rolepicker menu add <name> single|multi [\"description\"]: Add a menu to pick one or several roles from",
    "!rolepicker menu role add|remove <name> @roles: The roles in a menu",
    "!rolepicker menu list: The menus",
    "!rolepicker menu show <name> [next]: One menu and its roles",
    "!rolepicker access: Who may use the role picker",
    "Send !rolepicker help all for the other commands",
].join("\n")
/** The forms !rolepicker help leaves out, listed by !rolepicker help all */
export const rolePickerHelpAll = [
    "!rolepicker menu remove <name>: Remove a menu. Roles members chose stay",
    "!rolepicker menu set <name> mode single|multi: One role or several",
    "!rolepicker menu set <name> description \"text\"|none: Its description",
    "!rolepicker access allowed|blocked [next]: The allowed or blocked roles and users",
    "!rolepicker access allow|block|unallow|unblock role|user <mentions or IDs>: Change who may use it",
]

const menuName = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : undefined
const mode = (value: string | undefined) => value === "single" || value === "multi" ? value : undefined
const idList = (values: readonly string[], max: number) => {
    const ids = values.map(commandId)
    return ids.length > 0 && ids.length <= max && ids.every(id => id !== undefined) ? [...new Set(ids as string[])] : undefined
}
const change = (operation: RolePickerOperation): RolePickerCommand => ({ type: "change", operation })
const menuUsage = "Use !rolepicker menu list, show <name> [next], add <name> single|multi [\"description\"], remove <name>, set <name> mode single|multi, set <name> description \"text\"|none, or role add|remove <name> @roles..."
const accessUsage = "Use !rolepicker access, access allowed|blocked [next], or access allow|block|unallow|unblock role|user followed by mentions or IDs"

export function parseRolePickerCommand(args: readonly string[]): RolePickerCommand | { error: string } {
    const word = (index: number) => args[index]?.toLowerCase()
    if (!args.length || args.length === 1 && word(0) === "status") return { type: "status" }
    if (args.length === 1 && word(0) === "help") return { type: "help" }
    if (args.length === 1 && (word(0) === "on" || word(0) === "off")) return change({ type: "module", enabled: word(0) === "on" })
    if (word(0) === "menu") {
        const action = word(1), name = menuName(args[2])
        if (action === "list" && args.length === 2) return { type: "list" }
        if (action === "show" && name && (args.length === 3 || args.length === 4 && word(3) === "next")) return { type: "menu", name, next: args.length === 4 }
        if (action === "add" && name && mode(word(3)) && (args.length === 4 || args.length === 5)) return change({ type: "menu-add", name, mode: mode(word(3))!, ...(args[4] !== undefined ? { description: args[4] } : {}) })
        if (action === "remove" && name && args.length === 3) return change({ type: "menu-remove", name })
        if (action === "set" && name && args.length === 5 && word(3) === "mode" && mode(word(4))) return change({ type: "menu-update", name, mode: mode(word(4))! })
        if (action === "set" && name && args.length === 5 && word(3) === "description") return change({ type: "menu-update", name, description: word(4) === "none" ? null : args[4]! })
        const roleName = menuName(args[3]), roleIds = idList(args.slice(4), 25)
        if (action === "role" && (word(2) === "add" || word(2) === "remove") && roleName && roleIds) return change({ type: word(2) === "add" ? "menu-role-add" : "menu-role-remove", name: roleName, roleIds })
        return { error: menuUsage }
    }
    if (word(0) === "access") {
        if (args.length === 1) return { type: "access" }
        const verb = word(1), kind = word(2), ids = idList(args.slice(3), 100)
        if ((verb === "allowed" || verb === "blocked") && (args.length === 2 || args.length === 3 && kind === "next")) return { type: "access-list", list: verb === "allowed" ? "allow" : "block", next: args.length === 3 }
        if ((verb === "allow" || verb === "block" || verb === "unallow" || verb === "unblock") && (kind === "role" || kind === "user") && ids)
            return change({ type: verb.startsWith("un") ? "access-remove" : "access-add", list: verb.endsWith("allow") ? "allow" : "block", kind, ids })
        return { error: accessUsage }
    }
    return { error: "Use !rolepicker help for the role picker commands" }
}
// Turning the picker off and removing a menu stay available to administrators at DEFCON 1
export function rolePickerCritical(command: RolePickerCommand | { error: string }) {
    return "type" in command && command.type === "change" && (command.operation.type === "module" && !command.operation.enabled || command.operation.type === "menu-remove")
}
