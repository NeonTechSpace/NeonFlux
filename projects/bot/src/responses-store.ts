import {
    ResponseDefinition, ResponseEvaluateResult, ResponseManageResult, ResponseReply, type ResponseEvaluateInput, type ResponseManageRequest,
} from "@neonflux/contracts/responses"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

// Dashboard configuration jobs decode response definitions with these

export class ResponseStoreError extends Data.TaggedError("ResponseStoreError")<{
    readonly operation: "manage" | "evaluate"
    readonly status: number | null
}> {}

export interface ResponseStore {
    readonly manage: (request: ResponseManageRequest) => Effect.Effect<ResponseManageResult, ResponseStoreError>
    readonly evaluate: (request: ResponseEvaluateInput) => Effect.Effect<ResponseEvaluateResult, ResponseStoreError>
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
        manage: (input) => request("manage", input, ResponseManageResult).pipe(
            Effect.filterOrFail((result) => matchesManage(input, result), () => new ResponseStoreError({ operation: "manage", status: null })),
        ),
        evaluate: (input) => request("evaluate", input, ResponseEvaluateResult).pipe(
            // Roles may be requested only while the request carried none
            Effect.filterOrFail((result) => result.send ? result.messageId === input.messageId : !("memberRequired" in result) || input.roleIds === undefined,
                () => new ResponseStoreError({ operation: "evaluate", status: null })),
        ),
    }
}

export function managementErrorMessage(error: ResponseStoreError) {
    switch (error.status) {
        case 400: return "That is not valid. Check the name, trigger and reply, then try again"
        case 403: return "Only the server owner or an administrator can manage responses"
        case 404: return "Nothing with that name was found. Check the list"
        case 409: return "One with that name already exists"
        case 429: return "This server has reached its limit of custom commands and autoresponders, so nothing was added"
        default: return "NeonFlux couldn't confirm that change. Use show or list to check it before trying again"
    }
}

export type { ResponseDefinition, ResponseReply }
