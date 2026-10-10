import { commandId } from "./moderation-command.ts"

export type HelpDeskCommand = { type: "help" } | { type: "status" } | { type: "forum", add: boolean, channelId: string } | { type: "greeting", text: string | null }
    | { type: "tag", name: string } | { type: "nudge", hours: number | null } | { type: "guard", channelId: string | null } | { type: "archive", enabled: boolean }
export type AnswerCommand = { type: "help" } | { type: "list", next: boolean } | { type: "set", name: string, title: string, content: string } | { type: "remove", name: string } | { type: "post", name: string }

export const helpDeskHelp = [
    "!helpdesk: The help desk settings and the server's active threads",
    "!helpdesk forum add|remove #forum: The forums the help desk serves, up to 10",
    "!helpdesk greeting \"text\"|off: The short message on each new post",
    "!helpdesk tag \"name\": The forum tag !solved applies, Solved by default",
    "!helpdesk nudge <1-168>|off: Hours without a reply before the author gets one reminder",
    "!helpdesk guard #staff-channel|off: Warn staff when the server nears 1,000 active threads",
    "!helpdesk archive on|off: Give threads their channel's default auto-archive time",
    "In a help post: !solved closes it, !answer <name> posts a saved answer and !escalate <ticket-category> opens a ticket",
].join("\n")
export const answerHelp = [
    "!answer <name>: Post a saved answer here",
    "!answer list [next]: The saved answers",
    "!answer set <name> \"title\" \"text\": Save an answer or replace it, up to 50",
    "!answer remove <name>: Delete a saved answer",
].join("\n")

const answerName = (value: string | undefined) => value !== undefined && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value) && !["list", "set", "remove", "help"].includes(value) ? value : undefined
const bounded = (value: string, max: number) => !!value.trim() && value.length <= max

export function parseHelpDeskCommand(args: readonly string[]): HelpDeskCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), value = args.slice(1).join(" "), channelId = commandId(args[1])
    if (!verb || verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "forum" && (args[1] === "add" || args[1] === "remove") && args.length === 3) {
        const forumId = commandId(args[2])
        return forumId ? { type: "forum", add: args[1] === "add", channelId: forumId } : { error: "Name a forum channel" }
    }
    if (verb === "greeting" && args.length >= 2) return value.toLowerCase() === "off" ? { type: "greeting", text: null } : bounded(value, 500) ? { type: "greeting", text: value } : { error: "The greeting needs 1 to 500 characters" }
    if (verb === "tag" && args.length >= 2) return bounded(value, 50) ? { type: "tag", name: value.trim() } : { error: "Fluxer tag names have 1 to 50 characters" }
    if (verb === "nudge" && args.length === 2) {
        if (value.toLowerCase() === "off") return { type: "nudge", hours: null }
        const hours = /^\d{1,3}$/.test(value) ? Number(value) : 0
        return hours >= 1 && hours <= 168 ? { type: "nudge", hours } : { error: "Reminders wait 1 to 168 hours" }
    }
    if (verb === "guard" && args.length === 2) return value.toLowerCase() === "off" ? { type: "guard", channelId: null } : channelId ? { type: "guard", channelId } : { error: "Name a staff channel or off" }
    if (verb === "archive" && args.length === 2 && ["on", "off"].includes(value.toLowerCase())) return { type: "archive", enabled: value.toLowerCase() === "on" }
    return { error: "Check the help desk command syntax. Use !helpdesk help" }
}

export function parseAnswerCommand(args: readonly string[]): AnswerCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "list" && (args.length === 1 || args.length === 2 && args[1]!.toLowerCase() === "next")) return { type: "list", next: args.length === 2 }
    if (verb === "set") {
        const name = answerName(args[1])
        if (!name || args.length !== 4) return { error: "Use !answer set <name> \"title\" \"text\", with a lowercase name" }
        if (!bounded(args[2]!, 100)) return { error: "Answer titles have 1 to 100 characters" }
        return bounded(args[3]!, 2000) ? { type: "set", name, title: args[2]!.trim(), content: args[3]! } : { error: "Answers have 1 to 2000 characters" }
    }
    if (verb === "remove" && args.length === 2 && answerName(args[1])) return { type: "remove", name: args[1]! }
    const name = answerName(verb)
    return name && args.length === 1 ? { type: "post", name } : { error: "Check the answer command syntax. Use !answer help" }
}
