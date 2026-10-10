import { commandId } from "./moderation-command.ts"

export type TicketVisibility = "private" | "public"
export type TicketCommand =
    | { type: "help" | "settings" }
    | { type: "categories", next?: true }
    | { type: "module", enabled: boolean }
    | { type: "retention", days: number }
    | { type: "category-create", name: string, visibility: TicketVisibility, parentId?: string, supportRoleIds: string[] }
    | { type: "category-show" | "category-delete", name: string }
    | { type: "category-set", name: string, field: "visibility", value: TicketVisibility }
    | { type: "category-set", name: string, field: "parent", value: string | null }
    | { type: "category-set", name: string, field: "staff", value: string[] }
    | { type: "category-set", name: string, field: "enabled", value: boolean }
    | { type: "category-set", name: string, field: "description", value: string }
    | { type: "question", name: string, operation: "add", text: string }
    | { type: "question", name: string, operation: "set", index: number, text: string }
    | { type: "question", name: string, operation: "remove", index: number }
    | { type: "question", name: string, operation: "clear" }
    | { type: "canned", category: string, operation: "list", next?: true }
    | { type: "canned", category: string, operation: "remove", name: string }
    | { type: "canned", category: string, operation: "set", name: string, templateName: string }
    | { type: "open", category: string }
    | { type: "answer", intakeNo: number, index: number, text: string }
    | { type: "review" | "cancel", intakeNo: number }
    | { type: "submit", intakeNo: number, visibility: TicketVisibility }
    // A plain DM routed to the member's one open intake, never parsed from a command
    | { type: "intake-reply", intakeNo: number, text: string }
    | { type: "list", next?: true }
    | { type: "show" | "intake" | "claim" | "unclaim" | "close" | "reopen" | "reconcile" | "abandon", ticketNo: number }
    | { type: "attempt", ticketNo: number, attemptNo: number }
    | { type: "delete" | "erase", ticketNo: number, confirmed: true }
    | { type: "priority", ticketNo: number, priority: "low" | "normal" | "high" | "urgent" }
    | { type: "reply", ticketNo: number, text: string }
    | { type: "reply-canned", ticketNo: number, name: string }
    | { type: "notes", ticketNo: number, next?: true }
    | { type: "note", ticketNo: number, text: string }
    | { type: "note-show", ticketNo: number, noteNo: number }
    | { type: "transcript-capture", ticketNo: number, maxMessages: number }
    | { type: "transcript-list", ticketNo: number, next?: true }
    | { type: "transcript-show", ticketNo: number, transcriptNo: number, next?: true }

export const ticketHelp = [
    "!ticket open <category>: Open a ticket, in a DM with NeonFlux",
    "!ticket list [next]: Tickets you can see, in a DM",
    "!ticket show <number>: A ticket's state, people and channel",
    "!ticket claim <number>: Take a ticket",
    '!ticket reply <number> "text": Reply in the ticket channel',
    "!ticket close|reopen <number>: Close a ticket or open it again",
    "!ticket category create <name> private|public #parent|none @roles|none: Add a category, in a DM",
    "!ticket module on|off: Turn tickets on or off",
    "Send !ticket help all for the other commands",
].join("\n")
/** The forms !ticket help leaves out, listed by !ticket help all */
export const ticketHelpAll = [
    "!ticket categories [next]: The ticket categories",
    "!ticket settings: The ticket settings",
    "!ticket retention <1-365>: Days a closed ticket's private text is kept, 30 by default",
    "!ticket category show|delete <name>: Show or delete a category, in a DM",
    '!ticket category set <name> description "text": Its public description, in a DM',
    "!ticket category set <name> visibility private|public: Whether its new tickets are private or public, in a DM",
    "!ticket category set <name> parent #category|none: Where its channels go, in a DM",
    "!ticket category set <name> staff @roles|none: Its support roles, in a DM",
    "!ticket category set <name> enabled on|off: Turn a category on or off, in a DM",
    '!ticket question <category> add "question": Add an opening question, up to 5, in a DM',
    '!ticket question <category> set <1-5> "question": Change a question, in a DM',
    "!ticket question <category> remove <1-5> | clear: Remove one question or all, in a DM",
    "!ticket canned <category> set <name> <template>: Save a canned reply from a publishing template, in a DM",
    "!ticket canned <category> remove <name> | list [next]: Remove or list canned replies, in a DM",
    '!ticket answer <number> <1-5> "answer": Answer an opening question, in a DM',
    "!ticket review|cancel <number>: Check your answers or stop, in a DM",
    "!ticket submit <number> private|public: Send your answers and open the ticket, in a DM",
    "!ticket intake <number>: A ticket's opening answers, in a DM",
    "!ticket unclaim <number>: Release a ticket you took",
    "!ticket priority <number> low|normal|high|urgent: Set a ticket's priority",
    "!ticket reply <number> canned <name>: Post a canned reply",
    '!ticket note <number> add "text" | list [next] | show <note>: Private staff notes, in a DM',
    "!ticket transcript <number> capture [1-500]: Save the latest messages, in a DM",
    "!ticket transcript <number> list [next] | show <transcript> [next]: Read saved transcripts, in a DM",
    "!ticket attempt <number> <try>: What one try of a ticket action did, in a DM",
    "!ticket reconcile <number>: Check a close, reopen or opening that was not confirmed",
    "!ticket abandon <number>: Free the member's ticket slot when an opening was not confirmed",
    "!ticket delete <number> confirm: Delete a closed ticket's channel",
    "!ticket erase <number> confirm: Erase its stored answers, notes and transcripts",
]

const number = (value: string | undefined, max = Number.MAX_SAFE_INTEGER) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : undefined
const name = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : undefined
const text = (value: string | undefined, max = 2000) => value !== undefined && value.length <= max && value.replace(/[\u000c\u202e]/g, "").trim().length > 0 ? value : undefined
const visibility = (value: string | undefined): TicketVisibility | undefined => value === "private" || value === "public" ? value : undefined
const roleIds = (input: readonly string[]) => {
    if (input.length === 1 && input[0] === "none") return []
    const ids = input.map(commandId)
    return ids.length > 0 && ids.length <= 20 && ids.every(id => id !== undefined) ? [...new Set(ids as string[])] : undefined
}

export function parseTicketCommand(input: readonly string[]): TicketCommand | { error: string } {
    const args = [...input], verb = args.shift()?.toLowerCase() ?? "help"
    const error = { error: "Check quoting and syntax. Use !ticket help for examples" }
    if (["help", "settings"].includes(verb) && args.length === 0) return { type: verb as "help" | "settings" }
    if (verb === "categories" && (!args.length || args.length === 1 && args[0] === "next")) return { type: "categories", ...(args[0] ? { next: true } : {}) }
    if (verb === "module" && args.length === 1 && ["on", "off"].includes(args[0]!)) return { type: "module", enabled: args[0] === "on" }
    if (verb === "retention" && args.length === 1 && number(args[0], 365)) return { type: "retention", days: number(args[0], 365)! }
    if (verb === "category") {
        const operation = args[0], category = name(args[1])
        if (!category) return error
        if (["show", "delete"].includes(operation ?? "") && args.length === 2) return { type: operation === "show" ? "category-show" : "category-delete", name: category }
        if (operation === "create" && args.length >= 5 && visibility(args[2]) && (args[3] === "none" || commandId(args[3])) && roleIds(args.slice(4))) return {
            type: "category-create", name: category, visibility: visibility(args[2])!, supportRoleIds: roleIds(args.slice(4))!, ...(args[3] !== "none" ? { parentId: commandId(args[3])! } : {}),
        }
        if (operation === "set") {
            const field = args[2]
            if (field === "visibility" && args.length === 4 && visibility(args[3])) return { type: "category-set", name: category, field, value: visibility(args[3])! }
            if (field === "parent" && args.length === 4 && (args[3] === "none" || commandId(args[3]))) return { type: "category-set", name: category, field, value: args[3] === "none" ? null : commandId(args[3])! }
            if (field === "enabled" && args.length === 4 && ["on", "off"].includes(args[3]!)) return { type: "category-set", name: category, field, value: args[3] === "on" }
            if (field === "description" && args.length === 4 && args[3]!.length <= 500) return { type: "category-set", name: category, field, value: args[3]! }
            if (field === "staff" && roleIds(args.slice(3))) return { type: "category-set", name: category, field, value: roleIds(args.slice(3))! }
        }
    }
    if (verb === "question" && name(args[0])) {
        const category = name(args[0])!, operation = args[1]
        if (operation === "clear" && args.length === 2) return { type: "question", name: category, operation }
        if (operation === "add" && args.length === 3 && text(args[2], 200)) return { type: "question", name: category, operation, text: args[2]! }
        if (operation === "set" && args.length === 4 && number(args[2], 5) && text(args[3], 200)) return { type: "question", name: category, operation, index: number(args[2], 5)!, text: args[3]! }
        if (operation === "remove" && args.length === 3 && number(args[2], 5)) return { type: "question", name: category, operation, index: number(args[2], 5)! }
    }
    if (verb === "canned" && name(args[0])) {
        const category = name(args[0])!, operation = args[1]
        if (operation === "list" && (args.length === 2 || args.length === 3 && args[2] === "next")) return { type: "canned", category, operation, ...(args[2] ? { next: true } : {}) }
        if (operation === "remove" && args.length === 3 && name(args[2])) return { type: "canned", category, operation, name: name(args[2])! }
        if (operation === "set" && args.length === 4 && name(args[2]) && name(args[3])) return { type: "canned", category, operation, name: name(args[2])!, templateName: name(args[3])! }
    }
    if (verb === "open" && args.length === 1 && name(args[0])) return { type: "open", category: name(args[0])! }
    const no = number(args[0])
    if (verb === "answer" && args.length === 3 && no && number(args[1], 5) && text(args[2])) return { type: "answer", intakeNo: no, index: number(args[1], 5)!, text: args[2]! }
    if ((verb === "review" || verb === "cancel") && args.length === 1 && no) return { type: verb, intakeNo: no }
    if (verb === "submit" && args.length === 2 && no && visibility(args[1])) return { type: "submit", intakeNo: no, visibility: visibility(args[1])! }
    if (verb === "list" && (!args.length || args.length === 1 && args[0] === "next")) return { type: "list", ...(args[0] ? { next: true } : {}) }
    if (["show", "intake", "claim", "unclaim", "close", "reopen", "reconcile", "abandon"].includes(verb) && args.length === 1 && no) return { type: verb as "show", ticketNo: no }
    if (verb === "attempt" && args.length === 2 && no && number(args[1])) return { type: "attempt", ticketNo: no, attemptNo: number(args[1])! }
    if ((verb === "delete" || verb === "erase") && args.length === 2 && no && args[1] === "confirm") return { type: verb, ticketNo: no, confirmed: true }
    if (verb === "priority" && args.length === 2 && no && ["low", "normal", "high", "urgent"].includes(args[1]!)) return { type: "priority", ticketNo: no, priority: args[1] as "low" }
    if (verb === "reply" && no) {
        if (args.length === 3 && args[1] === "canned" && name(args[2])) return { type: "reply-canned", ticketNo: no, name: name(args[2])! }
        if (args.length === 2 && text(args[1])) return { type: "reply", ticketNo: no, text: args[1]! }
    }
    if (verb === "note" && no) {
        if (args[1] === "add" && args.length === 3 && text(args[2])) return { type: "note", ticketNo: no, text: args[2]! }
        if (args[1] === "list" && (args.length === 2 || args.length === 3 && args[2] === "next")) return { type: "notes", ticketNo: no, ...(args[2] ? { next: true } : {}) }
        if (args[1] === "show" && args.length === 3 && number(args[2])) return { type: "note-show", ticketNo: no, noteNo: number(args[2])! }
    }
    if (verb === "transcript" && no) {
        if (args[1] === "capture" && args.length <= 3 && (args[2] === undefined || number(args[2], 500))) return { type: "transcript-capture", ticketNo: no, maxMessages: number(args[2], 500) ?? 500 }
        if (args[1] === "list" && (args.length === 2 || args.length === 3 && args[2] === "next")) return { type: "transcript-list", ticketNo: no, ...(args[2] ? { next: true } : {}) }
        if (args[1] === "show" && number(args[2]) && (args.length === 3 || args.length === 4 && args[3] === "next")) return { type: "transcript-show", ticketNo: no, transcriptNo: number(args[2])!, ...(args[3] ? { next: true } : {}) }
    }
    return error
}

export function ticketPrivateCommand(command: TicketCommand) {
    return ["open", "answer", "review", "submit", "cancel", "intake-reply", "list", "intake", "attempt", "note", "notes", "note-show", "transcript-capture", "transcript-list", "transcript-show", "category-create", "category-show", "category-delete", "category-set", "question", "canned"].includes(command.type)
}
