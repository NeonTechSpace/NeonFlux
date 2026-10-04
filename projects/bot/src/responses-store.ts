import type {
    ResponseDefinition, ResponseEvaluateRequest, ResponseEvaluateResult, ResponseManageRequest,
    ResponseManageResult, ResponseReply,
} from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const finiteInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt())
const nameSchema = Schema.String.check(Schema.makeFilter((name) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)))
const idSchema = Schema.String.check(Schema.makeFilter((id) => snowflakes.isValid(id) && id !== "0"))
const textSchema = (max: number, min = 1) => Schema.String.check(Schema.makeFilter((text) => {
    const length = text.replace(/[\u000c\u202e]/g, "").trim().length
    return length >= min && text.length <= max
}))
const replySchema = Schema.Union([
    Schema.Struct({ type: Schema.Literal("text"), text: textSchema(2000) }),
    Schema.Struct({
        type: Schema.Literal("embed"),
        embed: Schema.Struct({
            title: textSchema(256, 0),
            description: textSchema(4000),
            color: Schema.optionalKey(finiteInteger.check(Schema.makeFilter((color) => color >= 0 && color <= 0xffffff))),
        }),
    }),
])
const triggerSchema = Schema.Struct({
    mode: Schema.Literals(["exact", "contains"]), text: textSchema(200),
})
const scopesSchema = Schema.mutable(Schema.Array(idSchema)).check(Schema.isMaxLength(20), Schema.makeFilter((ids) => new Set(ids).size === ids.length))
const timestampSchema = finiteInteger.check(Schema.makeFilter((time) => time >= 0 && Number.isSafeInteger(time)))
const definitionSchema = Schema.Struct({
    kind: Schema.Literals(["custom", "auto"]),
    name: nameSchema,
    reply: replySchema,
    trigger: Schema.optionalKey(triggerSchema),
    channelIds: scopesSchema,
    roleIds: scopesSchema,
    cooldownSeconds: finiteInteger.check(Schema.makeFilter((value) => value >= 0 && value <= 3600)),
    priority: finiteInteger.check(Schema.makeFilter((value) => value >= -100 && value <= 100)),
    enabled: Schema.Boolean,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
}).check(Schema.makeFilter((definition) => definition.createdAt <= definition.updatedAt
    && (definition.kind === "auto" ? definition.trigger !== undefined : definition.trigger === undefined)))
export const responseDefinitionSchema = definitionSchema
export const responseReplySchema = replySchema
export const responseTriggerSchema = triggerSchema
const manageSchema = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("definition"), definition: definitionSchema }),
    Schema.Struct({
        duplicate: Schema.Literal(false), type: Schema.Literal("list"), kind: Schema.Literals(["custom", "auto"]),
        page: finiteInteger, totalPages: finiteInteger, total: finiteInteger, moduleEnabled: Schema.Boolean,
        definitions: Schema.mutable(Schema.Array(definitionSchema)).check(Schema.isMaxLength(10)),
    }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), kind: Schema.Literals(["custom", "auto"]), name: nameSchema }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("module"), kind: Schema.Literals(["custom", "auto"]), enabled: Schema.Boolean }),
])
const evaluateSchema = Schema.Union([
    Schema.Struct({ send: Schema.Literal(false) }),
    Schema.Struct({ send: Schema.Literal(true), messageId: idSchema, ruleName: nameSchema, reply: replySchema }),
])

export class ResponseStoreError extends Data.TaggedError("ResponseStoreError")<{
    readonly operation: "manage" | "evaluate"
    readonly status: number | null
}> {}

export interface ResponseStore {
    readonly manage: (request: ResponseManageRequest) => Effect.Effect<ResponseManageResult, ResponseStoreError>
    readonly evaluate: (request: ResponseEvaluateRequest) => Effect.Effect<ResponseEvaluateResult, ResponseStoreError>
}

function sameIds(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((id) => right.includes(id))
}

function matchesManage(request: ResponseManageRequest, result: ResponseManageResult) {
    if (result.duplicate) return true
    const operation = request.operation
    if (operation.type === "module") return result.type === "module" && result.kind === request.kind && result.enabled === operation.enabled
    if (operation.type === "delete") return result.type === "deleted" && result.kind === request.kind && result.name === operation.name
    if (operation.type === "list") {
        return result.type === "list" && result.kind === request.kind && result.page === (operation.page ?? 1)
            && result.total >= 0 && result.total <= 100 && result.totalPages === Math.max(1, Math.ceil(result.total / 10))
            && result.page >= 1 && result.page <= result.totalPages
            && result.definitions.length === Math.min(10, Math.max(0, result.total - (result.page - 1) * 10))
            && new Set(result.definitions.map((definition) => definition.name)).size === result.definitions.length
            && result.definitions.every((definition) => definition.kind === request.kind)
    }
    if (result.type !== "definition" || result.definition.kind !== request.kind || result.definition.name !== operation.name) return false
    const definition = result.definition
    if (operation.type === "enable" || operation.type === "disable") return definition.enabled === (operation.type === "enable")
    if (operation.type !== "update") return true
    switch (operation.field) {
        case "channels": return sameIds(definition.channelIds, operation.channelIds)
        case "roles": return sameIds(definition.roleIds, operation.roleIds)
        case "cooldown": return definition.cooldownSeconds === operation.cooldownSeconds
        case "priority": return definition.priority === operation.priority
        case "trigger": return definition.trigger?.mode === operation.trigger.mode && definition.trigger.text === operation.trigger.text.trim()
        case "response": return JSON.stringify(definition.reply) === JSON.stringify(operation.reply)
    }
}

export function createResponseStore(config: BackendConfig): ResponseStore {
    const post = createBackendRequest(config)
    function request<A>(operation: "manage" | "evaluate", body: unknown, schema: Schema.Codec<A>) {
        return post(`/responses/${operation}`, body).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema)),
            Effect.mapError((error) => new ResponseStoreError({
                operation, status: "status" in error && typeof error.status === "number" ? error.status : null,
            })),
        )
    }
    return {
        manage: (input) => request("manage", input, manageSchema).pipe(
            Effect.filterOrFail((result) => matchesManage(input, result), () => new ResponseStoreError({ operation: "manage", status: null })),
        ),
        evaluate: (input) => request("evaluate", input, evaluateSchema).pipe(
            Effect.filterOrFail((result) => !result.send || result.messageId === input.messageId,
                () => new ResponseStoreError({ operation: "evaluate", status: null })),
        ),
    }
}

export function managementErrorMessage(error: ResponseStoreError) {
    switch (error.status) {
        case 400: return "Check the definition and command values. The backend rejected this request"
        case 403: return "Only the server owner or an administrator can manage responses"
        case 404: return "That definition was not found"
        case 409: return "A definition with that name already exists"
        case 429: return "The backend limit was reached. No additional definition or response was confirmed"
        default: return "I couldn't confirm that operation. Use show or list to check the current state before trying again"
    }
}

export type { ResponseDefinition, ResponseReply }
