import { Schema } from "effect"
import {
    ResponseDefinition,
    ResponseEvaluateInput,
    ResponseManageRequest,
    ResponseReply,
    ResponseReplyInput,
    isResponseName,
    type ResponseAutoOperation,
    type ResponseConfigurationOperation,
    type ResponseCustomOperation,
    type ResponseEvaluateRequest,
    type ResponseTrigger,
} from "@neonflux/contracts/responses"
import { decode, fail, listsChannel, source } from "./validation.ts"

export { RESPONSE_PAGE_SIZE as PAGE_SIZE } from "@neonflux/contracts/responses"
export const RECEIPT_RETENTION = 24 * 60 * 60 * 1000
export const MAX_DEFINITIONS = 100
export const CLEANUP_BATCH = 256

export function name(value: unknown): string {
    if (typeof value !== "string") fail(400, "Invalid definition")
    const normalized = value.trim().toLowerCase()
    if (!isResponseName(normalized)) fail(400, "Invalid definition")
    return normalized
}

// The reply of an archived definition
export const reply = (value: unknown): ResponseReply => decode(ResponseReplyInput, value, "Invalid definition")
// Triggers are stored trimmed and listed IDs once each
const trimmed = (input: ResponseTrigger): ResponseTrigger => ({ mode: input.mode, text: input.text.trim() })
const unique = (values: readonly string[]) => [...new Set(values)]

export function manageRequest(value: unknown, now: number): ResponseManageRequest {
    const input = decode(ResponseManageRequest, value, "Invalid definition")
    source(input, now)
    if (!input.adminAuthorized) fail(403, "Administrator permission required")
    return { ...input, operation: responseOperation(input.operation) } as ResponseManageRequest
}

export function evaluateRequest(value: unknown, now: number): ResponseEvaluateInput {
    const input = decode(ResponseEvaluateInput, value)
    source(input, now)
    return input
}

export function command(content: string, prefix = "!"): { name: string; args: string } | null {
    const value = content.trimStart()
    if (!value.startsWith(prefix)) return null
    const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(value.slice(prefix.length))
    return match ? { name: match[1]!.toLowerCase(), args: (match[2] ?? "").trim() } : { name: "", args: "" }
}

export function eligible(definition: ResponseDefinition, event: ResponseEvaluateRequest): boolean {
    return (
        definition.enabled &&
        (!definition.channelIds.length ||
            listsChannel(definition.channelIds, event.channelId, event.parentChannelId)) &&
        (!definition.roleIds.length || definition.roleIds.some((id) => event.roleIds.includes(id)))
    )
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
    return (
        b.priority - a.priority ||
        Number(b.trigger?.mode === "exact") - Number(a.trigger?.mode === "exact") ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
}

export function render(definition: ResponseDefinition, event: ResponseEvaluateRequest, prefix = "!"): ResponseReply {
    const values: Record<string, string> = {
        "user.name": event.userName,
        "user.id": event.userId,
        "user.mention": `<@${event.userId}>`,
        "channel.id": event.channelId,
        "server.id": event.serverId,
        args: definition.kind === "custom" ? (command(event.content, prefix)?.args ?? "") : "",
    }
    const substitute = (value: string) => value.replace(/\{([^{}]*)\}/g, (_, key: string) => values[key] ?? "")
    const rendered: ResponseReply =
        definition.reply.type === "text"
            ? { type: "text", text: substitute(definition.reply.text) }
            : {
                  type: "embed",
                  embed: {
                      ...definition.reply.embed,
                      title: substitute(definition.reply.embed.title),
                      description: substitute(definition.reply.embed.description),
                  },
              }
    // A filled-in reply must still fit the reply contract the bot decodes, such as 2000 characters of text
    if (!Schema.is(ResponseReply)(rendered)) fail(400, "Rendered response exceeds limits")
    return rendered
}

type Operation = ResponseCustomOperation | ResponseAutoOperation | ResponseConfigurationOperation["operation"]
/** A decoded operation as it is applied: names lowercased and checked against built-in commands, triggers trimmed and listed IDs once each */
export function responseOperation(op: Operation): Operation {
    if (op.type === "module" || op.type === "list" || op.type === "test") return op
    if ("definition" in op) {
        const fields = op.definition
        return {
            ...op,
            definition: {
                ...fields,
                name: name(fields.name),
                channelIds: unique(fields.channelIds),
                roleIds: unique(fields.roleIds),
                ...("trigger" in fields ? { trigger: trimmed(fields.trigger) } : {}),
            },
        }
    }
    const named = { ...op, name: name(op.name) }
    if (named.type === "create") return "trigger" in named ? { ...named, trigger: trimmed(named.trigger) } : named
    if (named.type !== "update") return named
    if (named.field === "channels") return { ...named, channelIds: unique(named.channelIds) }
    if (named.field === "roles") return { ...named, roleIds: unique(named.roleIds) }
    return named.field === "trigger" ? { ...named, trigger: trimmed(named.trigger) } : named
}
