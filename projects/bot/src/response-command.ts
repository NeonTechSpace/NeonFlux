import type {
    ResponseAutoOperation, ResponseCommonOperation, ResponseCustomOperation, ResponseDefinition,
    ResponseKind, ResponseManageResult, ResponseReply,
} from "@neonflux/backend/contracts"
import { format, snowflakes } from "@neontechspace/fluxerly/effect"
import { code, duration, onOff, type Card } from "./reply-style.ts"

/** `next` continues the member's last list page and never reaches the backend */
export type ManagementCommand =
    | { kind: "custom", operation: ResponseCustomOperation, next?: true }
    | { kind: "auto", operation: ResponseAutoOperation, next?: true }
export type ManagementParse = ManagementCommand | { error: string } | { help: string }

const validName = (name: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)
    && !["prefix", "replies", "nickname", "ping", "afk", "custom", "auto", "mod", "logs", "automod", "security", "defcon", "appeal", "publish", "roles", "verify", "autorole", "welcome", "goodbye", "ticket", "level", "rank", "leaderboard", "event", "milestone", "suggest", "voice", "lfg", "sticky", "sidebar", "memberlist", "onboarding", "preset", "alerts", "invites", "helpdesk", "answer", "solved", "escalate", "help", "health", "setup", "recovery", "rolepicker", "temprole", "cleanup", "backup", "export", "stats", "showcase", "profile", "youtube"].includes(name)

export function managementHelp(kind: ResponseKind) {
    const prefix = `!${kind}`, trigger = kind === "auto" ? ' exact|contains "trigger"' : ""
    return [
        `${prefix} create <name>${trigger} text "reply": ${kind === "auto" ? "Reply when a message matches the trigger" : "Make a command that answers with text"}`,
        `${prefix} create <name>${trigger} embed "title" "description" [#RRGGBB]: Answer with an embed`,
        `${prefix} list [next]: Your ${kind === "auto" ? "autoresponders" : "custom commands"}`,
        `${prefix} show <name>: One of them`,
        `${prefix} update <name> response text "reply": Change its reply`,
        `${prefix} enable|disable|delete <name>: Turn one on or off, or delete it`,
        `${prefix} module on|off: Turn ${kind === "auto" ? "autoresponders" : "custom commands"} on or off`,
        `Send ${prefix} help all for the other commands`,
    ].join("\n")
}
/** The forms !custom help or !auto help leaves out, listed by help all */
export function managementHelpAll(kind: ResponseKind) {
    const prefix = `!${kind}`
    return [
        `${prefix} update <name> response embed "title" "description" [#RRGGBB]: Reply with an embed instead`,
        `${prefix} update <name> channels #channel...|all: Where it works`,
        `${prefix} update <name> roles @role...|all: Who can use it`,
        `${prefix} update <name> cooldown <0-3600>: Seconds before the same member can use it again`,
        ...(kind === "auto" ? [`${prefix} update <name> trigger exact|contains "trigger": Change its trigger`, `${prefix} update <name> priority <-100 to 100>: Which one answers when several match`] : []),
        "Replies can use {user.name}, {user.id}, {user.mention}, {channel.id}, {server.id} and {args}",
    ]
}

function parseReply(args: readonly string[]): ResponseReply | undefined {
    if (args[0] === "text" && args.length === 2 && args[1]?.trim()) return { type: "text", text: args[1] }
    if (args[0] !== "embed" || (args.length !== 3 && args.length !== 4) || !args[2]?.trim()) return undefined
    if (args[3] !== undefined && !/^#[0-9a-f]{6}$/i.test(args[3])) return undefined
    return {
        type: "embed",
        embed: { title: args[1]!, description: args[2], ...(args[3] ? { color: Number.parseInt(args[3].slice(1), 16) } : {}) },
    }
}

function parseScopes(args: readonly string[], field: "channels" | "roles") {
    if (args.length === 1 && args[0] === "all") return []
    if (args.length === 0) return undefined
    const ids: string[] = []
    const pattern = field === "channels" ? /^<#([0-9]+)>$/ : /^<@&([0-9]+)>$/
    for (const value of args) {
        const id = pattern.exec(value)?.[1] ?? value
        if (!snowflakes.isValid(id) || id === "0") return undefined
        if (!ids.includes(id)) ids.push(id)
    }
    return ids.length <= 20 ? ids : undefined
}

export function parseManagement(kind: ResponseKind, args: readonly string[]): ManagementParse {
    const error = { error: `Check the command syntax. Use !${kind} help for examples` }
    const action = args[0]?.toLowerCase()
    if (!action || (action === "help" && args.length === 1)) return { help: managementHelp(kind) }
    const common = (operation: ResponseCommonOperation): ManagementCommand => kind === "custom"
        ? { kind, operation } : { kind, operation }
    if (action === "list" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { ...common({ type: "list" }), ...(args[1] ? { next: true } : {}) }
    if (action === "module" && args.length === 2 && (args[1] === "on" || args[1] === "off")) {
        return common({ type: "module", enabled: args[1] === "on" })
    }
    const name = args[1]?.trim().toLowerCase()
    if (!name || !validName(name)) return { error: "Use a name of 1-32 lowercase letters, numbers, underscores, or hyphens. Built-in names are reserved" }
    if (["show", "enable", "disable", "delete"].includes(action) && args.length === 2) {
        return common({ type: action as "show" | "enable" | "disable" | "delete", name })
    }
    if (action === "create") {
        if (kind === "custom") {
            const reply = parseReply(args.slice(2))
            return reply ? { kind, operation: { type: "create", name, reply } } : error
        }
        const mode = args[2]
        const text = args[3]?.trim()
        const reply = parseReply(args.slice(4))
        return (mode === "exact" || mode === "contains") && text && reply
            ? { kind, operation: { type: "create", name, trigger: { mode, text }, reply } } : error
    }
    if (action !== "update") return error
    const field = args[2]
    if (field === "response") {
        const reply = parseReply(args.slice(3))
        return reply ? common({ type: "update", name, field, reply }) : error
    }
    if (field === "channels" || field === "roles") {
        const ids = parseScopes(args.slice(3), field)
        if (!ids) return { error: "Use up to 20 channel or role mentions or IDs, or all" }
        return common(field === "channels" ? { type: "update", name, field, channelIds: ids } : { type: "update", name, field, roleIds: ids })
    }
    if (field === "cooldown" && args.length === 4) {
        const cooldownSeconds = Number(args[3])
        return Number.isInteger(cooldownSeconds) && cooldownSeconds >= 0 && cooldownSeconds <= 3600
            ? common({ type: "update", name, field, cooldownSeconds }) : error
    }
    if (kind === "auto" && field === "priority" && args.length === 4) {
        const priority = Number(args[3])
        return Number.isInteger(priority) && priority >= -100 && priority <= 100
            ? { kind, operation: { type: "update", name, field, priority } } : error
    }
    if (kind === "auto" && field === "trigger" && args.length === 5) {
        const mode = args[3]
        const text = args[4]?.trim()
        return (mode === "exact" || mode === "contains") && text
            ? { kind, operation: { type: "update", name, field, trigger: { mode, text } } } : error
    }
    return error
}

function snippet(value: string, max: number) {
    if (value.length <= max) return value
    const prefix = value.slice(0, max - 1).replace(/[\ud800-\udbff]$/, "")
    return `${prefix}…`
}

const singular = (kind: ResponseKind) => kind === "custom" ? "Custom command" : "Autoresponder"
const plural = (kind: ResponseKind) => kind === "custom" ? "Custom commands" : "Autoresponders"
const trigger = (value: NonNullable<ResponseDefinition["trigger"]>, max: number) => `${value.mode === "exact" ? "Exact" : "Contains"}: ${snippet(value.text, max)}`

function definitionCard(definition: ResponseDefinition): Card {
    const body = definition.reply.type === "text" ? snippet(definition.reply.text, 600)
        : `Embed **${snippet(definition.reply.embed.title, 100)}**\n${snippet(definition.reply.embed.description, 500)}`
    return { title: `${singular(definition.kind)} ${definition.name}`, fields: [["Status", onOff(definition.enabled)],
        ["Channels", definition.channelIds.length ? definition.channelIds.map((id) => format.channelMention(id)).join(", ") : "All"],
        ["Roles", definition.roleIds.length ? definition.roleIds.map((id) => format.roleMention(id)).join(", ") : "All"],
        ...(definition.trigger ? [["Trigger", trigger(definition.trigger, 100)] as const, ["Priority", String(definition.priority)] as const] : []),
        ["Cooldown", definition.cooldownSeconds ? `${duration(definition.cooldownSeconds)} per member` : "None"],
        ["Response", body]] }
}

/** The one field an update changed, with its new value */
function updated(definition: ResponseDefinition, field: Extract<ManagementCommand["operation"], { type: "update" }>["field"]) {
    const name = `${singular(definition.kind)} ${definition.name}`, reply = definition.reply
    switch (field) {
        case "response": return `${name} now replies with ${reply.type === "text" ? `the text "${snippet(reply.text, 200)}"` : `the embed "${snippet(reply.embed.title, 100)}"`}`
        case "channels": return definition.channelIds.length ? `${name} now works in ${definition.channelIds.map((id) => format.channelMention(id)).join(", ")}` : `${name} now works in every channel`
        case "roles": return definition.roleIds.length ? `${name} now works for members with ${definition.roleIds.map((id) => format.roleMention(id)).join(", ")}` : `${name} now works for every member`
        case "cooldown": return definition.cooldownSeconds ? `${name} now has a cooldown of ${duration(definition.cooldownSeconds)} per member` : `${name} has no cooldown now`
        case "trigger": return `${name} now answers messages that ${definition.trigger?.mode === "exact" ? "are exactly" : "contain"} "${snippet(definition.trigger?.text ?? "", 100)}"`
        case "priority": return `${name} now has priority ${definition.priority}`
    }
}

/** The reply to a management command: A card for a new or shown definition or a list, a plain line for a change or confirmation */
export function managementResultMessage(result: ResponseManageResult, operation: ManagementCommand["operation"], prefix: string): Card | string | undefined {
    if (result.duplicate) return undefined
    switch (result.type) {
        case "definition": return operation.type === "enable" || operation.type === "disable" ? `${singular(result.definition.kind)} ${result.definition.name} is ${onOff(result.definition.enabled).toLowerCase()}`
            : operation.type === "update" ? updated(result.definition, operation.field) : definitionCard(result.definition)
        case "deleted": return `${singular(result.kind)} ${result.name} deleted`
        case "module": return result.enabled ? `${plural(result.kind)} are on` : `${plural(result.kind)} are off. Their settings stay saved`
        case "list": return { title: plural(result.kind), description: result.definitions.map((definition) => `**${definition.name}** ${onOff(definition.enabled)}${definition.trigger ? `, ${trigger(definition.trigger, 80)}` : ""}`).join("\n")
                || `No ${plural(result.kind).toLowerCase()} yet. Add one with ${code(`${prefix}${result.kind} create <name>${result.kind === "auto" ? ' exact|contains "trigger"' : ""} text "reply"`)}`,
            fields: [["Status", onOff(result.moduleEnabled)], ...(result.page < result.totalPages ? [["Next", code(`${prefix}${result.kind} list next`)] as const] : [])],
            ...(result.totalPages > 1 ? { footer: `${result.total} in all` } : {}) }
    }
}
