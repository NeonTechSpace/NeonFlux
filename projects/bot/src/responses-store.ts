import {
    ResponseEvaluateResult,
    ResponseManageResult,
    type ResponseEvaluateInput,
    type ResponseManageRequest,
} from "@neonflux/contracts/responses"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class ResponseStoreError extends Data.TaggedError("ResponseStoreError")<{
    readonly operation: "manage" | "evaluate"
    readonly status: number | null
}> {}

export interface ResponseStore {
    readonly manage: (request: ResponseManageRequest) => Effect.Effect<ResponseManageResult, ResponseStoreError>
    readonly evaluate: (request: ResponseEvaluateInput) => Effect.Effect<ResponseEvaluateResult, ResponseStoreError>
}

// The store checks that an answer is about the kind, name and page it asked for. Saved values and counts are the backend's own postconditions
function matchesManage(request: ResponseManageRequest, result: ResponseManageResult) {
    if (result.duplicate) return true
    const operation = request.operation
    if (operation.type === "module") return result.type === "module" && result.kind === request.kind
    if (operation.type === "test") return result.type === "test"
    if (operation.type === "delete")
        return result.type === "deleted" && result.kind === request.kind && result.name === operation.name
    if (operation.type === "list")
        return (
            result.type === "list" &&
            result.kind === request.kind &&
            result.page === (operation.page ?? 1) &&
            result.page <= result.totalPages &&
            result.definitions.every((definition) => definition.kind === request.kind)
        )
    return (
        result.type === "definition" &&
        result.definition.kind === request.kind &&
        result.definition.name === operation.name
    )
}

export function createResponseStore(config: BackendConfig): ResponseStore {
    const post = createBackendRequest(config)
    function request<A>(operation: "manage" | "evaluate", body: unknown, schema: Schema.Codec<A>) {
        return post(`/responses/${operation}`, body).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema)),
            Effect.mapError(
                (error) =>
                    new ResponseStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    }
    return {
        manage: (input) =>
            request("manage", input, ResponseManageResult).pipe(
                Effect.filterOrFail(
                    (result) => matchesManage(input, result),
                    () => new ResponseStoreError({ operation: "manage", status: null }),
                ),
            ),
        evaluate: (input) =>
            request("evaluate", input, ResponseEvaluateResult).pipe(
                // Roles may be requested only while the request carried none
                Effect.filterOrFail(
                    (result) =>
                        result.send
                            ? result.messageId === input.messageId
                            : !("memberRequired" in result) || input.roleIds === undefined,
                    () => new ResponseStoreError({ operation: "evaluate", status: null }),
                ),
            ),
    }
}

export function managementErrorMessage(error: ResponseStoreError) {
    switch (error.status) {
        case 400:
            return "That is not valid. Check the name, trigger and reply, then try again"
        case 403:
            return "Only the server owner or an administrator can manage responses"
        case 404:
            return "Nothing with that name was found. Check the list"
        case 409:
            return "One with that name already exists"
        case 429:
            return "This server has reached its limit of custom commands and autoresponders, so nothing was added"
        default:
            return "NeonFlux couldn't confirm that change. Use show or list to check it before trying again"
    }
}
