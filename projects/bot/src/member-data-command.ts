import { validServerId } from "./server-scope.ts"

/** Servers are picked by their number in the member's last !mydata list. Export alone takes a server ID, for a server the list did not reach */
export type MemberDataCommand =
    | { type: "help" }
    | { type: "list", next?: true }
    | { type: "show", number: number }
    | { type: "export", serverId?: string }
    | { type: "delete", number: number, confirm: boolean }

export const memberDataHelp = [
    "!mydata [next]: The servers where NeonFlux stores something about you, numbered",
    "!mydata <number>: What it stores in one of them, by feature",
    "!mydata export [server ID]: Get it as a JSON file, for every server or one",
    "!mydata delete <number>: See what would be deleted and what is kept, then confirm",
    "Use these in a DM with NeonFlux",
].join("\n")
const usage = "Use !mydata, !mydata <number>, !mydata export or !mydata delete <number>. !mydata help explains each"

// Member data commands are private and cover every server, so they take the fixed ! prefix and no --server selector
export function isMemberDataCommand(content: string) {
    return /^\s*!mydata(?:\s|$)/i.test(content)
}
const listNumber = (value: string | undefined) => value && /^\d{1,4}$/.test(value) && Number(value) >= 1 ? Number(value) : undefined
export function parseMemberDataCommand(content: string): MemberDataCommand | { error: string } {
    const [, action, second, third, ...rest] = content.trim().split(/\s+/)
    if (rest.length) return { error: usage }
    if (action === undefined) return { type: "list" }
    const verb = action.toLowerCase()
    if ((verb === "help" || verb === "next") && second === undefined) return verb === "help" ? { type: "help" } : { type: "list", next: true }
    if (listNumber(action) && second === undefined) return { type: "show", number: listNumber(action)! }
    if (verb === "export" && third === undefined) {
        if (second === undefined) return { type: "export" }
        return validServerId(second) ? { type: "export", serverId: second } : { error: "Use a numeric server ID, such as !mydata export 123456789012345678" }
    }
    if (verb === "delete") {
        const number = listNumber(second)
        if (!number) return { error: "Name the server by its number in your !mydata list, such as !mydata delete 1" }
        if (third === undefined || third.toLowerCase() === "confirm") return { type: "delete", number, confirm: third !== undefined }
    }
    return { error: usage }
}
