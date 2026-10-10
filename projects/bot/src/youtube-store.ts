import { YoutubeManageResult, YoutubeQueryResult, YoutubeWorkResult, type YoutubeManageRequest, type YoutubeQueryRequest, type YoutubeWorkRequest } from "@neonflux/contracts/youtube"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class YoutubeStoreError extends Data.TaggedError("YoutubeStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface YoutubeStore {
    query(input: YoutubeQueryRequest): Effect.Effect<YoutubeQueryResult, YoutubeStoreError>
    manage(input: YoutubeManageRequest): Effect.Effect<YoutubeManageResult, YoutubeStoreError>
    work(input: YoutubeWorkRequest): Effect.Effect<YoutubeWorkResult, YoutubeStoreError>
}
export function createYoutubeStore(config: BackendConfig): YoutubeStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/youtube/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new YoutubeStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, YoutubeQueryResult),
        manage: input => call("manage", input, YoutubeManageResult),
        work: input => call("work", input, YoutubeWorkResult),
    }
}
