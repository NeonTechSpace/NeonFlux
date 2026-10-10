import { commandId } from "./moderation-command.ts"

export type MemberListCommand = { type: "help" } | { type: "list" } | { type: "reset" } | { type: "set", roleIds: string[] } | { type: "move", roleId: string, position: number }

export const memberListHelp = [
    "!memberlist: The order of roles shown separately in the member list, top first",
    "!memberlist set @role @role...: Set the whole order, top first, naming each of those roles once",
    "!memberlist move @role <position>: Move one role, where 1 is the top",
    "!memberlist reset: Clear the order, so the member list follows the role order again, for the owner or Administrators",
    "This changes only the member list, never permissions",
].join("\n")

export function parseMemberListCommand(args: readonly string[]): MemberListCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "reset" && args.length === 1) return { type: "reset" }
    if (verb === "set" && args.length >= 2 && args.length <= 251) {
        const roleIds = args.slice(1).map(commandId)
        return roleIds.every(id => id !== undefined) && new Set(roleIds).size === roleIds.length ? { type: "set", roleIds: roleIds as string[] } : { error: "Name each role once, as a mention or ID" }
    }
    if (verb === "move" && args.length === 3) {
        const roleId = commandId(args[1]), position = /^\d{1,3}$/.test(args[2]!) ? Number(args[2]) : 0
        return roleId && position >= 1 ? { type: "move", roleId, position } : { error: "Use !memberlist move @role <position>, where 1 is the top" }
    }
    return { error: "Check the memberlist command syntax. Use !memberlist help" }
}
