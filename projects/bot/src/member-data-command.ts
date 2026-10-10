import { commands } from "@neontechspace/fluxerly/effect"
import { validServerId } from "./server-scope.ts"

/** A server is picked by its number in the last !mydata list, or by its ID for one the list did not reach */
type Server = { number: number } | { serverId: string }
type MemberDataCommand =
    | { type: "help" }
    | { type: "list"; next?: true }
    | ({ type: "show" } & Server)
    | { type: "export"; serverId?: string }
    | ({ type: "delete"; confirm: boolean } & Server)

export const memberDataHelp = [
    "!mydata [next]: The servers where NeonFlux stores something about you, numbered",
    "!mydata <number or server ID>: What it stores in one of them, by feature",
    "!mydata export [server ID]: Get it as a JSON file, for every server or one",
    "!mydata delete <number or server ID>: See what would be deleted and what is kept, then confirm",
    "Use these in a DM with NeonFlux",
].join("\n")
const usage =
    "Use !mydata, !mydata <number>, !mydata export or !mydata delete <number>. A server ID also works in place of a number. !mydata help explains each"

// Member data commands are private and cover every server, so they take the fixed ! prefix and no --server selector
export function isMemberDataCommand(content: string) {
    return /^\s*!mydata(?:\s|$)/i.test(content)
}
const listNumber = { type: "integer", min: 1, max: 9999 } as const
export function parseMemberDataCommand(content: string): MemberDataCommand | { error: string } {
    const [, action, second, third, ...rest] = content.trim().split(/\s+/)
    if (rest.length) return { error: usage }
    if (action === undefined) return { type: "list" }
    const verb = action.toLowerCase()
    if ((verb === "help" || verb === "next") && second === undefined)
        return verb === "help" ? { type: "help" } : { type: "list", next: true }
    const server = (value: string | undefined): Server | undefined => {
        const number = commands.parseArgument(value, listNumber)
        return number ? { number } : validServerId(value) ? { serverId: value } : undefined
    }
    const shown = server(action)
    if (shown && second === undefined) return { type: "show", ...shown }
    if (verb === "export" && third === undefined) {
        if (second === undefined) return { type: "export" }
        return validServerId(second)
            ? { type: "export", serverId: second }
            : { error: "Use a numeric server ID, such as !mydata export 123456789012345678" }
    }
    if (verb === "delete") {
        const chosen = server(second)
        if (!chosen)
            return {
                error: "Name the server by its number in your !mydata list or by its ID, such as !mydata delete 1",
            }
        if (third === undefined || third.toLowerCase() === "confirm")
            return { type: "delete", ...chosen, confirm: third !== undefined }
    }
    return { error: usage }
}
