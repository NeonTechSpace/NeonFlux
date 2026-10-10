import { commandId } from "./moderation-command.ts"

export type SidebarCommand = { type: "help" } | { type: "status" } | { type: "remove" } | { type: "add", name: string, categoryId: string | null } | { type: "set", name: string }

export const sidebarDefaultName = "NeonFlux dashboard"
export const sidebarHelp = [
    "!sidebar: Show the dashboard link in the server sidebar",
    "!sidebar add [\"name\"] [category-ID]: Create a link channel that opens this server's NeonFlux dashboard",
    "!sidebar set \"name\": Rename the link and point it at the current dashboard address",
    "!sidebar remove: Delete the link channel",
    "Server owner, Administrator or Manage Server",
].join("\n")

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
const visible = (value: string) => value.replace(/[\u000c‮]/g, "").trim()
const linkName = (value: string) => value.length <= 100 && visible(value) ? value.trim() : undefined
const nameError = { error: "Link names need 1 to 100 characters" }

export function parseSidebarCommand(args: readonly string[]): SidebarCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "remove" && args.length === 1) return { type: "remove" }
    if (verb === "add") {
        const category = args.length > 2 ? commandId(args.at(-1)) : undefined, words = category ? args.slice(1, -1) : args.slice(1)
        const name = words.length ? linkName(words.join(" ")) : sidebarDefaultName
        return name ? { type: "add", name, categoryId: category ?? null } : nameError
    }
    if (verb === "set" && args.length >= 2) { const name = linkName(args.slice(1).join(" ")); return name ? { type: "set", name } : nameError }
    return { error: "Check the sidebar command syntax. Use !sidebar help" }
}
