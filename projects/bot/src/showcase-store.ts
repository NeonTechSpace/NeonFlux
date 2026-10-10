import { ShowcaseCompleteResult, ShowcaseFailResult, ShowcaseListResult, ShowcaseReadyResult, ShowcaseStartResult, ShowcaseState, type ShowcaseCompleteRequest, type ShowcaseFailRequest,
    type ShowcaseListRequest, type ShowcaseManageRequest, type ShowcaseReadyRequest, type ShowcaseSettingsRequest, type ShowcaseStartRequest } from "@neonflux/contracts/showcases"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class ShowcaseStoreError extends Data.TaggedError("ShowcaseStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface ShowcaseStore {
    manage(input: ShowcaseManageRequest): Effect.Effect<ShowcaseState, ShowcaseStoreError>
    settings(input: ShowcaseSettingsRequest): Effect.Effect<ShowcaseState, ShowcaseStoreError>
    list(input: ShowcaseListRequest): Effect.Effect<ShowcaseListResult, ShowcaseStoreError>
    ready(input: ShowcaseReadyRequest): Effect.Effect<ShowcaseReadyResult, ShowcaseStoreError>
    start(input: ShowcaseStartRequest): Effect.Effect<ShowcaseStartResult, ShowcaseStoreError>
    complete(input: ShowcaseCompleteRequest): Effect.Effect<ShowcaseCompleteResult, ShowcaseStoreError>
    fail(input: ShowcaseFailRequest): Effect.Effect<ShowcaseFailResult, ShowcaseStoreError>
}
export function createShowcaseStore(config: BackendConfig): ShowcaseStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean = () => true) => request(`/showcase/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.filterOrFail(matches, () => new ShowcaseStoreError({ operation, status: null })),
        Effect.mapError(error => new ShowcaseStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    const sameJob = (input: { jobId: string }) => (value: { job: { id: string } }) => value.job.id === input.jobId
    return {
        manage: input => call("manage", input, ShowcaseState),
        settings: input => call("settings", input, ShowcaseState),
        list: input => call("list", input, ShowcaseListResult),
        ready: input => call("ready", input, ShowcaseReadyResult, value => value.jobs.every(row => row.state === "queued")),
        // A grant always belongs to this request and acts as the bot
        start: input => call("start", input, ShowcaseStartResult,
            value => sameJob(input)(value) && (!value.grant || value.grant.source?.type === "showcase" && value.grant.source.jobId === input.jobId && value.grant.actorId === input.member.botId)),
        complete: input => call("complete", input, ShowcaseCompleteResult, sameJob(input)),
        fail: input => call("fail", input, ShowcaseFailResult),
    }
}
