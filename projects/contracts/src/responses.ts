import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Name, Str, Text, hasText, isName, origin } from "./common.ts"

// Custom commands and autoresponders

/** Lists show ten definitions per page */
export const RESPONSE_PAGE_SIZE = 10
export const ResponseKind = Schema.Literals(["custom", "auto"])
export type ResponseKind = typeof ResponseKind.Type
/** Every built-in command, the one catalog that the reserved custom command names follow */
export const BUILT_IN_COMMANDS = ["ping", "afk", "prefix", "custom", "auto", "mod", "case", "logs", "automod", "security", "defcon", "appeals", "appeal", "publish",
    "roles", "verify", "autorole", "welcome", "goodbye", "ticket", "rank", "leaderboard", "level", "events", "event", "milestone", "suggest", "cleanup",
    "backup"] as const
export type BuiltInCommand = typeof BUILT_IN_COMMANDS[number]
/** Whether a lowercase name can name a custom command or autoresponder: a stored name that no built-in command already uses */
export const isResponseName = (value: string) => isName(value) && !(BUILT_IN_COMMANDS as readonly string[]).includes(value)
/** A stored name. Requests may name a definition in any case and with surrounding space, which the backend removes */
const name = Name
export const ResponseTrigger = Schema.Struct({ mode: Schema.Literals(["exact", "contains"]), text: Text(200) })
export type ResponseTrigger = typeof ResponseTrigger.Type
export const ResponseReply = Schema.Union([
    Schema.Struct({ type: Schema.Literal("text"), text: Text(2000) }),
    Schema.Struct({ type: Schema.Literal("embed"), embed: Schema.Struct({ title: Str(256), description: Text(4000), color: Schema.optionalKey(Int(0, 0xffffff)) }) }),
])
export type ResponseReply = typeof ResponseReply.Type
const placeholders = new Set(["user.name", "user.id", "user.mention", "channel.id", "server.id", "args"])
const templated = (value: string) => [...value.matchAll(/\{([^{}]*)\}/g)].every(match => placeholders.has(match[1]!))
/** A reply as the bot sends it. It may use only the placeholders the backend fills in when it renders the reply */
export const ResponseReplyInput = ResponseReply.check(Schema.makeFilter(reply => reply.type === "text" ? templated(reply.text) : templated(reply.embed.title) && templated(reply.embed.description)))
/** A trigger as the bot sends it. The backend stores its text trimmed */
export const ResponseTriggerInput = Schema.Struct({ mode: ResponseTrigger.fields.mode,
    text: Schema.String.check(Schema.makeFilter((value: string) => hasText(value) && value.trim().length <= 200)) })
const scope = Ids(20).check(Schema.isUnique())
export const ResponseDefinition = Schema.Struct({ kind: ResponseKind, name, reply: ResponseReply, trigger: Schema.optionalKey(ResponseTrigger), channelIds: scope, roleIds: scope,
    cooldownSeconds: Int(0, 3600), priority: Int(-100, 100), enabled: Schema.Boolean, createdAt: Millis, updatedAt: Millis })
    .check(Schema.makeFilter(definition => definition.createdAt <= definition.updatedAt && (definition.kind === "auto" ? definition.trigger !== undefined : definition.trigger === undefined)))
export type ResponseDefinition = typeof ResponseDefinition.Type

// Operations as the bot sends them. The backend lowercases and trims names, trims triggers and lists each channel and role once
const named = { name: Schema.String }, op = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields })
const update = <const F extends string, S extends Schema.Struct.Fields>(field: F, fields: S) => op("update", { ...named, field: Schema.Literal(field), ...fields })
const reads = [op("show", named), op("list", { page: Schema.optionalKey(Int(1)) })]
const changes = [update("response", { reply: ResponseReplyInput }), update("channels", { channelIds: Ids(20) }), update("roles", { roleIds: Ids(20) }),
    update("cooldown", { cooldownSeconds: ResponseDefinition.fields.cooldownSeconds }), Schema.Struct({ type: Schema.Literals(["enable", "disable", "delete"]), ...named }),
    op("module", { enabled: Schema.Boolean })]
const customChanges = [...changes, op("create", { ...named, reply: ResponseReplyInput })]
const autoChanges = [...changes, op("create", { ...named, reply: ResponseReplyInput, trigger: ResponseTriggerInput }), update("trigger", { trigger: ResponseTriggerInput }),
    update("priority", { priority: ResponseDefinition.fields.priority })]
export const ResponseCommonOperation = Schema.Union([...reads, ...changes])
export type ResponseCommonOperation = typeof ResponseCommonOperation.Type
export const ResponseCustomOperation = Schema.Union([...reads, ...customChanges])
export type ResponseCustomOperation = typeof ResponseCustomOperation.Type
export const ResponseAutoOperation = Schema.Union([...reads, ...autoChanges])
export type ResponseAutoOperation = typeof ResponseAutoOperation.Type
const source = { ...origin, serverId: Id, messageId: Id, createdAt: Millis, actorId: Id, adminAuthorized: Schema.Boolean }
export const ResponseManageRequest = Schema.Union([
    Schema.Struct({ ...source, kind: Schema.Literal("custom"), operation: ResponseCustomOperation }),
    Schema.Struct({ ...source, kind: Schema.Literal("auto"), operation: ResponseAutoOperation }),
])
export type ResponseManageRequest = typeof ResponseManageRequest.Type
export const ResponseManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("definition"), definition: ResponseDefinition }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("list"), kind: ResponseKind, page: Int(), totalPages: Int(), total: Int(), moduleEnabled: Schema.Boolean,
        definitions: List(ResponseDefinition, RESPONSE_PAGE_SIZE) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), kind: ResponseKind, name }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("module"), kind: ResponseKind, enabled: Schema.Boolean }),
])
export type ResponseManageResult = typeof ResponseManageResult.Type

const message = { serverId: Id, messageId: Id, createdAt: Millis, channelId: Id,
    userId: Id, userName: Schema.String.check(Schema.isMaxLength(256), Schema.makeFilter((value: string) => value.trim() !== "")),
    content: Str(20000) }
export const ResponseEvaluateRequest = Schema.Struct({ ...message, roleIds: Ids(1000) })
export type ResponseEvaluateRequest = typeof ResponseEvaluateRequest.Type
export const ResponseEvaluateResult = Schema.Union([
    Schema.Struct({ send: Schema.Literal(false) }),
    Schema.Struct({ send: Schema.Literal(true), messageId: Id, ruleName: name, reply: ResponseReply }),
])
export type ResponseEvaluateResult = typeof ResponseEvaluateResult.Type
