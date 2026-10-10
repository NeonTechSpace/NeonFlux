import { validServerId } from "./server-scope.ts"

export type MemberDataCommand =
    | { type: "help" }
    | { type: "list" }
    | { type: "export", serverId?: string }
    | { type: "delete", serverId: string, confirm: boolean }

export const memberDataHelp = [
    "!mydata lists what NeonFlux stores about you, per server and feature",
    "!mydata export sends it to you as a JSON file. Add a server ID to export one server",
    "!mydata delete <server ID> shows what would be deleted and what is kept, then asks you to confirm",
    "Use these in a direct message with the bot",
].join("\n")
const usage = "Use !mydata, !mydata export [server ID] or !mydata delete <server ID>. !mydata help explains each"

// Member data commands are private and cover every server, so they take the fixed ! prefix and no --server selector
export function isMemberDataCommand(content: string) {
    return /^\s*!mydata(?:\s|$)/i.test(content)
}
export function parseMemberDataCommand(content: string): MemberDataCommand | { error: string } {
    const [, action, serverId, confirm, ...rest] = content.trim().split(/\s+/)
    if (rest.length) return { error: usage }
    if (action === undefined) return { type: "list" }
    const verb = action.toLowerCase()
    if (verb === "help" && serverId === undefined) return { type: "help" }
    if (verb === "export" && confirm === undefined) {
        if (serverId === undefined) return { type: "export" }
        return validServerId(serverId) ? { type: "export", serverId } : { error: "Use a numeric server ID, such as !mydata export 123456789012345678" }
    }
    if (verb === "delete") {
        if (!validServerId(serverId)) return { error: "Name the server by its numeric ID, such as !mydata delete 123456789012345678. !mydata lists the servers" }
        if (confirm === undefined || confirm.toLowerCase() === "confirm") return { type: "delete", serverId, confirm: confirm !== undefined }
    }
    return { error: usage }
}
