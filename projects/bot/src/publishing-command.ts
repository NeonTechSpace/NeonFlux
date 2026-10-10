import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"
import { parseScheduleCommand, type ScheduleCommand } from "./schedule-command.ts"

export type PublishingCommand =
    | { type: "help" }
    | { type: "schedule", command: ScheduleCommand | { error: string } }
    | { type: "query", operation: C.PublishingQueryRequest["operation"], next?: true }
    | { type: "settings", patch: Partial<C.PublishingSettings> }
    | { type: "create", kind: C.PublishingKind, name: string }
    | { type: "draft", kind: C.PublishingKind, name: string, operation: "delete" | "preview" | "send" | "clone" | "update", channelId?: string, toKind?: C.PublishingKind, toName?: string, edit?: C.PublishingDraftEdit }
    | { type: "edit", postNo: number, kind: C.PublishingKind, name: string }
    | { type: "reconcile", postNo: number }
    | { type: "forget", postNo: number }
    | { type: "resolve", postNo: number, outcome: "sent" | "failed", messageId?: string }
export const publishingHelp = [
    "!publish create <name>: Start a draft",
    '!publish set <name> content|title|description "text": Write the draft',
    "!publish preview <name>: See the draft here",
    "!publish send <name> #channel: Post the draft",
    "!publish edit <post-number> <name>: Update a sent post from a draft",
    "!publish list [next]: Your drafts",
    "!publish posts [next]: Sent posts and their numbers",
    "!publish schedule help: Scheduled posts",
    "Send !publish help all for the other commands",
].join("\n")
/** The forms !publish help leaves out, listed by !publish help all */
export const publishingHelpAll = [
    "!publish show|delete <name>: Show or delete a draft",
    "!publish clone <name> <new-name>: Copy a draft",
    "!publish template create|show|delete|preview|clone|list ...: The same commands for reusable templates",
    "!publish template clone <name> <new-name> draft: Start a draft from a template",
    '!publish set <name> url|timestamp "value" | color #RRGGBB: Its link, time or color',
    '!publish set <name> author "name" ["URL"|none] ["icon URL"|none]: Its author line',
    '!publish set <name> footer "text" ["icon URL"]: Its footer',
    '!publish set <name> image|thumbnail "URL" ["description"]: Its pictures',
    '!publish field <name> add "name" "value" [on|off]: Add a field, on to show it side by side',
    '!publish field <name> set <1-25> "name" "value" [on|off] | remove <1-25>: Change or remove a field',
    "!publish clear <name> content|embed|fields|<embed part>: Clear part of a draft",
    "!publish status [post-number]: Whether publishing is on, or one post",
    "!publish reconcile <post-number>: Check a post that was not confirmed",
    "!publish resolve <post-number> sent <message-id> | failed: Record by hand what happened to a post",
    "!publish forget <post-number>: Stop following a post. The message stays",
    "!publish module on|off: Turn publishing on or off",
]
const integer = (value: string | undefined, max = Number.MAX_SAFE_INTEGER) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : undefined
const nameValue = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : undefined
const url = (value: string | undefined) => {
    if (!value || value.length > 2048) return undefined
    try { const parsed = new URL(value); return parsed.href.length <= 2048 && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? value : undefined } catch { return undefined }
}

export function parsePublishingCommand(input: readonly string[]): PublishingCommand | { error: string } {
    if (input[0]?.toLowerCase() === "schedule") return { type: "schedule", command: parseScheduleCommand(input.slice(1)) }
    const args = [...input]
    const kind: C.PublishingKind = args[0] === "template" ? (args.shift(), "template") : "draft"
    const verb = args.shift()?.toLowerCase()
    const error = { error: "Check quoting and values. Use !publish help for examples" }
    if (!verb || verb === "help" && !args.length) return { type: "help" }
    const name = nameValue(args[0])
    const next = args.length === 1 && args[0] === "next" ? { next: true as const } : !args.length ? {} : undefined
    if (verb === "list" && next) return { type: "query", operation: { type: "draft-list", kind }, ...next }
    if (verb === "create" && args.length === 1 && name) return { type: "create", kind, name }
    if (verb === "show" && args.length === 1 && name) return { type: "query", operation: { type: "draft-show", kind, name } }
    if ((verb === "delete" || verb === "preview") && args.length === 1 && name) return { type: "draft", kind, name, operation: verb }
    if (verb === "clone" && args.length >= 2 && args.length <= 3 && name && nameValue(args[1]) && (args[2] === undefined || args[2] === "draft" || args[2] === "template")) return { type: "draft", kind, name, operation: "clone", toName: nameValue(args[1])!, toKind: args[2] as C.PublishingKind ?? kind }
    if (verb === "send" && args.length === 2 && name && commandId(args[1])) return { type: "draft", kind, name, operation: "send", channelId: commandId(args[1])! }
    const postNo = integer(args[0])
    if (kind === "draft" && verb === "status" && args.length <= 1 && (!args.length || postNo)) return { type: "query", operation: postNo ? { type: "post-show", postNo } : { type: "settings" } }
    if (kind === "draft" && verb === "posts" && next) return { type: "query", operation: { type: "post-list" }, ...next }
    if (kind === "draft" && (verb === "forget" || verb === "reconcile") && args.length === 1 && postNo) return { type: verb, postNo }
    if (verb === "edit" && args.length === 2 && postNo && nameValue(args[1])) return { type: "edit", kind, postNo, name: nameValue(args[1])! }
    if (kind === "draft" && verb === "module" && args.length === 1 && ["on", "off"].includes(args[0]!)) return { type: "settings", patch: { enabled: args[0] === "on" } }
    if (kind === "draft" && verb === "resolve" && postNo && args[1] === "failed" && args.length === 2) return { type: "resolve", postNo, outcome: "failed" }
    if (kind === "draft" && verb === "resolve" && postNo && args[1] === "sent" && args.length === 3 && commandId(args[2])) {
        return { type: "resolve", postNo, outcome: "sent", messageId: commandId(args[2])! }
    }
    let edit: C.PublishingDraftEdit | undefined
    const field = args[1]
    if (verb === "clear" && args.length === 2 && name) {
        if (field === "content") edit = { type: "content", content: "" }
        else if (field === "embed") edit = { type: "embed-clear" }
        else if (field === "fields") edit = { type: "fields-clear" }
        else if (["title", "description", "url", "color", "timestamp", "author", "footer", "image", "thumbnail"].includes(field ?? "")) edit = { type: "embed-property", field: field as "title", value: null }
    }
    if (verb === "set" && name && field) {
        const value = args[2]
        if (value !== undefined && args.length === 3) {
            if (field === "content") edit = { type: "content", content: value }
            if (field === "title" || field === "description" || field === "timestamp") edit = { type: "embed-property", field, value }
            if (field === "url" && url(value)) edit = { type: "embed-property", field, value }
            if (field === "color" && /^#[0-9a-f]{6}$/i.test(value)) edit = { type: "embed-property", field, value: parseInt(value.slice(1), 16) }
        }
        if (field === "author" && value && args.length >= 3 && args.length <= 5 && args.slice(3).every((v) => v === "none" || url(v))) edit = { type: "embed-property", field, value: { name: value, ...(args[3] && args[3] !== "none" ? { url: args[3] } : {}), ...(args[4] && args[4] !== "none" ? { iconUrl: args[4] } : {}) } }
        if (field === "footer" && value && args.length >= 3 && args.length <= 4 && (args[3] === undefined || url(args[3]))) edit = { type: "embed-property", field, value: { text: value, ...(args[3] ? { iconUrl: args[3] } : {}) } }
        if ((field === "image" || field === "thumbnail") && url(value) && args.length >= 3 && args.length <= 4) edit = { type: "embed-property", field, value: { url: value!, ...(args[3] !== undefined ? { description: args[3] } : {}) } }
    }
    if (verb === "field" && name) {
        if (field === "remove" && args.length === 3 && integer(args[2], 25)) edit = { type: "field-remove", index: integer(args[2], 25)! }
        const offset = field === "set" ? 3 : 2
        if ((field === "add" || field === "set" && integer(args[2], 25)) && args.length >= offset + 2 && args.length <= offset + 3 && (args[offset + 2] === undefined || ["on", "off"].includes(args[offset + 2]!))) {
            const value = { name: args[offset]!, value: args[offset + 1]!, inline: args[offset + 2] === "on" }
            edit = field === "add" ? { type: "field-add", field: value } : { type: "field-set", index: integer(args[2], 25)!, field: value }
        }
    }
    return edit && name ? { type: "draft", kind, name, operation: "update", edit } : error
}
