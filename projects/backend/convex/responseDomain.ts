import type {
    ResponseAutoOperation, ResponseCustomOperation, ResponseDefinition, ResponseEvaluateRequest,
    ResponseKind, ResponseManageRequest, ResponseReply, ResponseTrigger,
} from "../contracts.js"
import { fail, isId, object, requireId, requireServer } from "./validation.ts"

export const EVENT_MAX_AGE = 15 * 60 * 1000
export const EVENT_FUTURE_LIMIT = 60 * 1000
export const RECEIPT_RETENTION = 24 * 60 * 60 * 1000
export const MAX_DEFINITIONS = 100
export const CLEANUP_BATCH = 256
export const PAGE_SIZE = 10
const reservedNames = new Set(["prefix", "nickname", "ping", "afk", "custom", "auto", "mod", "case", "logs", "automod", "security", "defcon", "appeal", "appeals", "publish", "roles", "verify", "autorole", "welcome", "goodbye", "ticket", "level", "rank", "leaderboard", "event", "events", "backup", "cleanup", "milestone", "suggest", "voice"])
const placeholders = new Set(["user.name", "user.id", "user.mention", "channel.id", "server.id", "args"])

function nonempty(value: string): boolean {
    return value.replace(/[\u000c\u202e]/g, "").trim().length > 0
}

export function kind(value: unknown): ResponseKind {
    if (value !== "custom" && value !== "auto") fail(400, "Invalid definition")
    return value
}

export function name(value: unknown): string {
    if (typeof value !== "string") fail(400, "Invalid definition")
    const normalized = value.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized) || reservedNames.has(normalized)) {
        fail(400, "Invalid definition")
    }
    return normalized
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
    if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !nonempty(value))) {
        fail(400, "Invalid definition")
    }
    return value
}

function template(value: string) {
    for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
        if (!placeholders.has(match[1]!)) fail(400, "Invalid definition")
    }
    return value
}

export function reply(value: unknown): ResponseReply {
    const input = object(value)
    if (input.type === "text") return { type: "text", text: template(text(input.text, 2000)) }
    if (input.type !== "embed") fail(400, "Invalid definition")
    const embed = object(input.embed)
    const title = template(text(embed.title, 256, true))
    const description = template(text(embed.description, 4000))
    if (embed.color !== undefined && (!Number.isInteger(embed.color) || (embed.color as number) < 0 || (embed.color as number) > 0xffffff)) {
        fail(400, "Invalid definition")
    }
    return { type: "embed", embed: { title, description, ...(embed.color === undefined ? {} : { color: embed.color as number }) } }
}

export function trigger(value: unknown): ResponseTrigger {
    const input = object(value)
    if (input.mode !== "exact" && input.mode !== "contains") fail(400, "Invalid definition")
    if (typeof input.text !== "string" || !nonempty(input.text.trim()) || input.text.trim().length > 200) fail(400, "Invalid definition")
    return { mode: input.mode, text: input.text.trim() }
}

export function ids(value: unknown, maximum = 20): string[] {
    if (!Array.isArray(value) || value.length > maximum || !value.every(isId)) fail(400, "Invalid definition")
    return [...new Set(value)]
}

export function cooldown(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 3600) fail(400, "Invalid definition")
    return value as number
}

export function priority(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < -100 || (value as number) > 100) fail(400, "Invalid definition")
    return value as number
}

export function sourceEvent(value: unknown, now: number) {
    const input = object(value)
    const serverId = requireId(input.serverId)
    requireServer(serverId)
    const messageId = requireId(input.messageId)
    const createdAt = input.createdAt
    if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0
        || (createdAt as number) < now - EVENT_MAX_AGE || (createdAt as number) > now + EVENT_FUTURE_LIMIT) {
        fail(400, "Invalid source event")
    }
    return { serverId, messageId, createdAt: createdAt as number }
}

export function manageRequest(value: unknown, now: number): ResponseManageRequest {
    const input = object(value)
    const event = sourceEvent(input, now)
    const actorId = requireId(input.actorId)
    if (input.adminAuthorized !== true) fail(403, "Administrator permission required")
    const ruleKind = kind(input.kind)
    const operation = responseOperation(input.operation, ruleKind)
    return { ...event, actorId, adminAuthorized: true, kind: ruleKind, operation } as ResponseManageRequest
}

export function evaluateRequest(value: unknown, now: number): ResponseEvaluateRequest {
    const input = object(value)
    const event = sourceEvent(input, now)
    const channelId = requireId(input.channelId)
    const userId = requireId(input.userId)
    if (typeof input.userName !== "string" || input.userName.length > 256 || !input.userName.trim()
        || typeof input.content !== "string" || input.content.length > 20000) fail(400, "Invalid request")
    return { ...event, channelId, userId, userName: input.userName, roleIds: ids(input.roleIds, 1000), content: input.content }
}

export function command(content: string, prefix = "!"): { name: string, args: string } | null {
    const value = content.trimStart()
    if (!value.startsWith(prefix)) return null
    const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(value.slice(prefix.length))
    return match ? { name: match[1]!.toLowerCase(), args: (match[2] ?? "").trim() } : { name: "", args: "" }
}

export function eligible(definition: ResponseDefinition, event: ResponseEvaluateRequest): boolean {
    return definition.enabled
        && (!definition.channelIds.length || definition.channelIds.includes(event.channelId))
        && (!definition.roleIds.length || definition.roleIds.some(id => event.roleIds.includes(id)))
}

export function matches(definition: ResponseDefinition, event: ResponseEvaluateRequest, prefix = "!"): boolean {
    const parsed = command(event.content, prefix)
    if (definition.kind === "custom") return parsed?.name === definition.name
    if (parsed || !definition.trigger) return false
    const content = event.content.trim().toLowerCase()
    const needle = definition.trigger.text.toLowerCase()
    return definition.trigger.mode === "exact" ? content === needle : content.includes(needle)
}

export function compareDefinitions(a: ResponseDefinition, b: ResponseDefinition): number {
    return b.priority - a.priority
        || Number(b.trigger?.mode === "exact") - Number(a.trigger?.mode === "exact")
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

export function render(definition: ResponseDefinition, event: ResponseEvaluateRequest, prefix = "!"): ResponseReply {
    const values: Record<string, string> = {
        "user.name": event.userName, "user.id": event.userId, "user.mention": `<@${event.userId}>`,
        "channel.id": event.channelId, "server.id": event.serverId,
        args: definition.kind === "custom" ? command(event.content, prefix)?.args ?? "" : "",
    }
    const substitute = (value: string) => value.replace(/\{([^{}]*)\}/g, (_, key: string) => values[key] ?? "")
    const rendered: ResponseReply = definition.reply.type === "text"
        ? { type: "text", text: substitute(definition.reply.text) }
        : { type: "embed", embed: { ...definition.reply.embed, title: substitute(definition.reply.embed.title), description: substitute(definition.reply.embed.description) } }
    const valid = rendered.type === "text" ? rendered.text.length <= 2000 && nonempty(rendered.text)
        : rendered.embed.title.length <= 256 && rendered.embed.description.length <= 4000 && nonempty(rendered.embed.description)
    if (!valid) fail(400, "Rendered response exceeds limits")
    return rendered
}

export function responseOperation(value: unknown, ruleKind: ResponseKind): ResponseCustomOperation | ResponseAutoOperation {
    const op = object(value)
    let operation: ResponseCustomOperation | ResponseAutoOperation
    if (op.type === "module") {
        if (typeof op.enabled !== "boolean") fail(400, "Invalid definition")
        operation = { type: "module", enabled: op.enabled }
    } else if (op.type === "list") {
        const page = op.page ?? 1
        if (!Number.isSafeInteger(page) || (page as number) < 1) fail(400, "Invalid request")
        operation = { type: "list", page: page as number }
    } else {
        const ruleName = name(op.name)
        if (op.type === "create") {
            const content = reply(op.reply)
            operation = ruleKind === "custom" ? { type: "create", name: ruleName, reply: content }
                : { type: "create", name: ruleName, reply: content, trigger: trigger(op.trigger) }
        } else if (op.type === "show" || op.type === "enable" || op.type === "disable" || op.type === "delete") {
            operation = { type: op.type, name: ruleName }
        } else if (op.type === "update") {
            if (op.field === "response") operation = { type: "update", name: ruleName, field: "response", reply: reply(op.reply) }
            else if (op.field === "channels") operation = { type: "update", name: ruleName, field: "channels", channelIds: ids(op.channelIds) }
            else if (op.field === "roles") operation = { type: "update", name: ruleName, field: "roles", roleIds: ids(op.roleIds) }
            else if (op.field === "cooldown") operation = { type: "update", name: ruleName, field: "cooldown", cooldownSeconds: cooldown(op.cooldownSeconds) }
            else if (ruleKind === "auto" && op.field === "trigger") operation = { type: "update", name: ruleName, field: "trigger", trigger: trigger(op.trigger) }
            else if (ruleKind === "auto" && op.field === "priority") operation = { type: "update", name: ruleName, field: "priority", priority: priority(op.priority) }
            else fail(400, "Invalid definition")
        } else fail(400, "Invalid request")
    }
    return operation
}
