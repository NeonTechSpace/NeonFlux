import type {
    ResponseAutoOperation, ResponseCommonOperation, ResponseCustomOperation, ResponseDefinition,
    ResponseKind, ResponseManageResult, ResponseReply,
} from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"

export type ManagementCommand =
    | { kind: "custom", operation: ResponseCustomOperation }
    | { kind: "auto", operation: ResponseAutoOperation }
export type ManagementParse = ManagementCommand | { error: string } | { help: string }

const validName = (name: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)
    && !["prefix", "ping", "afk", "custom", "auto", "mod", "case", "logs", "automod", "security", "defcon", "appeal", "appeals", "publish", "roles", "verify", "autorole"].includes(name)

export function managementHelp(kind: ResponseKind) {
    const prefix = `!${kind}`
    return [
        `${prefix} create <name>${kind === "auto" ? ' exact|contains "trigger"' : ""} text "reply"`,
        `${prefix} create <name>${kind === "auto" ? ' exact|contains "trigger"' : ""} embed "title" "description" [#RRGGBB]`,
        `${prefix} show <name> | list [page]`,
        `${prefix} update <name> response text "reply" | embed "title" "description" [#RRGGBB]`,
        `${prefix} update <name> channels #channel... | all`,
        `${prefix} update <name> roles @role... | all`,
        `${prefix} update <name> cooldown <seconds, 0-3600>`,
        ...(kind === "auto" ? [`${prefix} update <name> trigger exact|contains "trigger"`, `${prefix} update <name> priority <-100 to 100>`] : []),
        `${prefix} enable|disable|delete <name>`,
        `${prefix} module on|off`,
        "Use quotes around text with spaces. Templates support {user.name}, {user.id}, {user.mention}, {channel.id}, {server.id}, and {args}",
    ].join("\n")
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
    if (action === "list" && args.length <= 2) {
        const page = args[1] === undefined ? undefined : Number(args[1])
        if (page !== undefined && (!Number.isSafeInteger(page) || page < 1 || page > 10)) return error
        return common({ type: "list", ...(page === undefined ? {} : { page }) })
    }
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

function formatDefinition(definition: ResponseDefinition) {
    const body = definition.reply.type === "text" ? snippet(definition.reply.text, 600)
        : `Embed: ${snippet(definition.reply.embed.title, 100)}\n${snippet(definition.reply.embed.description, 500)}`
    return [
        `${definition.kind} ${definition.name}: ${definition.enabled ? "Enabled" : "Disabled"}`,
        ...(definition.trigger ? [`Trigger: ${definition.trigger.mode} ${snippet(definition.trigger.text, 100)}`, `Priority: ${definition.priority}`] : []),
        `Cooldown: ${definition.cooldownSeconds}s per user`,
        `Channels: ${definition.channelIds.length ? definition.channelIds.map((id) => `<#${id}>`).join(", ") : "All"}`,
        `Roles: ${definition.roleIds.length ? definition.roleIds.map((id) => `<@&${id}>`).join(", ") : "All"}`,
        `Response: ${body}`,
    ].join("\n")
}

export function managementResultMessage(result: ResponseManageResult): string | undefined {
    if (result.duplicate) return undefined
    switch (result.type) {
        case "definition": return formatDefinition(result.definition)
        case "deleted": return `Deleted ${result.kind} ${result.name}`
        case "module": return `${result.kind === "custom" ? "Custom commands" : "Autoresponders"} ${result.enabled ? "enabled" : "disabled"}. Definitions remain saved`
        case "list": return [
            `${result.kind === "custom" ? "Custom commands" : "Autoresponders"}: ${result.moduleEnabled ? "On" : "Off"}, page ${result.page}/${result.totalPages}, ${result.total} total`,
            ...result.definitions.map((definition) => `${definition.name}: ${definition.enabled ? "Enabled" : "Disabled"}${definition.trigger ? `, ${definition.trigger.mode} ${snippet(definition.trigger.text, 80)}` : ""}`),
        ].join("\n")
    }
}
