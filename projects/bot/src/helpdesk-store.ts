import { HelpDeskAnswersResult, HelpDeskGetResult, HelpDeskGuardResult, HelpDeskManageResult, HelpDeskOpenedResult, HelpDeskWorkResult, type HelpDeskAnswersRequest, type HelpDeskGetRequest,
    type HelpDeskGuardRequest, type HelpDeskManageRequest, type HelpDeskOpenedRequest, type HelpDeskWorkRequest } from "@neonflux/contracts/helpdesk"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class HelpDeskStoreError extends Data.TaggedError("HelpDeskStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface HelpDeskStore {
    get(input: HelpDeskGetRequest): Effect.Effect<HelpDeskGetResult, HelpDeskStoreError>
    answers(input: HelpDeskAnswersRequest): Effect.Effect<HelpDeskAnswersResult, HelpDeskStoreError>
    manage(input: HelpDeskManageRequest): Effect.Effect<HelpDeskManageResult, HelpDeskStoreError>
    opened(input: HelpDeskOpenedRequest): Effect.Effect<HelpDeskOpenedResult, HelpDeskStoreError>
    work(input: HelpDeskWorkRequest): Effect.Effect<HelpDeskWorkResult, HelpDeskStoreError>
    guard(input: HelpDeskGuardRequest): Effect.Effect<HelpDeskGuardResult, HelpDeskStoreError>
}
export function createHelpDeskStore(config: BackendConfig): HelpDeskStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/helpdesk/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new HelpDeskStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        get: input => call("get", input, HelpDeskGetResult),
        answers: input => call("answers", input, HelpDeskAnswersResult),
        manage: input => call("manage", input, HelpDeskManageResult),
        opened: input => call("opened", input, HelpDeskOpenedResult),
        work: input => call("work", input, HelpDeskWorkResult),
        guard: input => call("guard", input, HelpDeskGuardResult),
    }
}
