import { commandId } from "./moderation-command.ts"

export type TicketVisibility = "private" | "public"
export type TicketCommand =
    | { type: "help" | "categories" | "settings" }
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
    | { type: "canned", category: string, operation: "list" }
    | { type: "canned", category: string, operation: "remove", name: string }
    | { type: "canned", category: string, operation: "set", name: string, templateName: string }
    | { type: "open", category: string }
    | { type: "answer", intakeNo: number, index: number, text: string }
    | { type: "review" | "cancel", intakeNo: number }
    | { type: "submit", intakeNo: number, visibility: TicketVisibility }
    // A plain DM routed to the member's one open intake, never parsed from a command
    | { type: "intake-reply", intakeNo: number, text: string }
    | { type: "list", beforeTicketNo?: number }
    | { type: "status" | "intake" | "claim" | "unclaim" | "close" | "reopen" | "reconcile" | "abandon", ticketNo: number }
    | { type: "attempt", ticketNo: number, attemptNo: number }
    | { type: "delete" | "erase", ticketNo: number, confirmed: true }
    | { type: "priority", ticketNo: number, priority: "low" | "normal" | "high" | "urgent" }
    | { type: "reply", ticketNo: number, text: string }
    | { type: "reply-canned", ticketNo: number, name: string }
    | { type: "notes", ticketNo: number, beforeEntryNo?: number }
    | { type: "note", ticketNo: number, text: string }
    | { type: "transcript-capture", ticketNo: number, maxMessages: number }
    | { type: "transcript-list", ticketNo: number, beforeTranscriptNo?: number }
    | { type: "transcript-show", ticketNo: number, transcriptNo: number, page: number }

export const ticketHelp = [
    "!ticket categories | help | settings | module on|off | retention <1..365 days>",
    "!ticket category create <name> private|public #parent|none @support-roles...|none",
    "All category configuration commands, questions and canned replies use a verified 1:1 DM",
    '!ticket category show|delete <name> | category set <name> visibility private|public | parent #category|none | staff @roles...|none | enabled on|off | description "text"',
    '!ticket question <category> add "question" | set <1..5> "question" | remove <1..5> | clear. Questions allow 200 characters',
    "!ticket canned <category> set <name> <publishing-template> | remove <name> | list",
    "In a verified 1:1 DM: !ticket open <category> | answer <intake-number> <1..5> \"answer\" | review|cancel <intake-number>",
    "With one open intake, reply in the DM without a command: your answer, back, send or cancel",
    "!ticket submit <intake-number> private|public confirms the displayed conversation audience. Intake answers stay private",
    "!ticket list [before-ticket] | status|intake <ticket-number>",
    "In a verified 1:1 DM: !ticket attempt <ticket-number> <attempt-number> shows retained operation metadata",
    '!ticket claim|unclaim <ticket-number> | priority <ticket-number> low|normal|high|urgent | reply <ticket-number> "text" | reply <ticket-number> canned <name>',
    "!ticket close|reopen|reconcile <ticket-number> | delete|erase <ticket-number> confirm",
    "!ticket abandon <ticket-number> releases the requester slot of a creation whose result stays unknown. Check for a leftover channel yourself",
    'Staff notes in a verified 1:1 DM only: !ticket note <ticket-number> add "text" | list [before-entry]',
    "Transcripts in a verified 1:1 DM only: !ticket transcript <ticket-number> capture [1..500] | list [before-transcript] | show <transcript-number> [page]",
    "Intake and notes never enter channel replies or transcripts. Unknown native effects never replay",
].join("\n")

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
    if (["help", "categories", "settings"].includes(verb) && args.length === 0) return { type: verb as "help" | "categories" | "settings" }
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
        if (operation === "list" && args.length === 2) return { type: "canned", category, operation }
        if (operation === "remove" && args.length === 3 && name(args[2])) return { type: "canned", category, operation, name: name(args[2])! }
        if (operation === "set" && args.length === 4 && name(args[2]) && name(args[3])) return { type: "canned", category, operation, name: name(args[2])!, templateName: name(args[3])! }
    }
    if (verb === "open" && args.length === 1 && name(args[0])) return { type: "open", category: name(args[0])! }
    const no = number(args[0])
    if (verb === "answer" && args.length === 3 && no && number(args[1], 5) && text(args[2])) return { type: "answer", intakeNo: no, index: number(args[1], 5)!, text: args[2]! }
    if ((verb === "review" || verb === "cancel") && args.length === 1 && no) return { type: verb, intakeNo: no }
    if (verb === "submit" && args.length === 2 && no && visibility(args[1])) return { type: "submit", intakeNo: no, visibility: visibility(args[1])! }
    if (verb === "list" && args.length <= 1 && (!args.length || no)) return { type: "list", ...(no ? { beforeTicketNo: no } : {}) }
    if (["status", "intake", "claim", "unclaim", "close", "reopen", "reconcile", "abandon"].includes(verb) && args.length === 1 && no) return { type: verb as "status", ticketNo: no }
    if (verb === "attempt" && args.length === 2 && no && number(args[1])) return { type: "attempt", ticketNo: no, attemptNo: number(args[1])! }
    if ((verb === "delete" || verb === "erase") && args.length === 2 && no && args[1] === "confirm") return { type: verb, ticketNo: no, confirmed: true }
    if (verb === "priority" && args.length === 2 && no && ["low", "normal", "high", "urgent"].includes(args[1]!)) return { type: "priority", ticketNo: no, priority: args[1] as "low" }
    if (verb === "reply" && no) {
        if (args.length === 3 && args[1] === "canned" && name(args[2])) return { type: "reply-canned", ticketNo: no, name: name(args[2])! }
        if (args.length === 2 && text(args[1])) return { type: "reply", ticketNo: no, text: args[1]! }
    }
    if (verb === "note" && no) {
        if (args[1] === "add" && args.length === 3 && text(args[2])) return { type: "note", ticketNo: no, text: args[2]! }
        if (args[1] === "list" && args.length <= 3 && (args[2] === undefined || number(args[2]))) return { type: "notes", ticketNo: no, ...(args[2] ? { beforeEntryNo: number(args[2])! } : {}) }
    }
    if (verb === "transcript" && no) {
        if (args[1] === "capture" && args.length <= 3 && (args[2] === undefined || number(args[2], 500))) return { type: "transcript-capture", ticketNo: no, maxMessages: number(args[2], 500) ?? 500 }
        if (args[1] === "list" && args.length <= 3 && (args[2] === undefined || number(args[2]))) return { type: "transcript-list", ticketNo: no, ...(args[2] ? { beforeTranscriptNo: number(args[2])! } : {}) }
        if (args[1] === "show" && (args.length === 3 || args.length === 4) && number(args[2]) && (args[3] === undefined || number(args[3]))) {
            return { type: "transcript-show", ticketNo: no, transcriptNo: number(args[2])!, page: number(args[3]) ?? 1 }
        }
    }
    return error
}

export function ticketPrivateCommand(command: TicketCommand) {
    return ["open", "answer", "review", "submit", "cancel", "intake-reply", "list", "intake", "attempt", "note", "notes", "transcript-capture", "transcript-list", "transcript-show", "category-create", "category-show", "category-delete", "category-set", "question", "canned"].includes(command.type)
}
