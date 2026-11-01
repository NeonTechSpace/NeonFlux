import {
    FeedManageResult,
    FeedQueryResult,
    FeedWorkResult,
    type FeedManageRequest,
    type FeedQueryRequest,
    type FeedWorkRequest,
} from "@neonflux/contracts/feeds"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class FeedStoreError extends Data.TaggedError("FeedStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface FeedStore {
    query(input: FeedQueryRequest): Effect.Effect<FeedQueryResult, FeedStoreError>
    manage(input: FeedManageRequest): Effect.Effect<FeedManageResult, FeedStoreError>
    work(input: FeedWorkRequest): Effect.Effect<FeedWorkResult, FeedStoreError>
}
export function createFeedStore(config: BackendConfig): FeedStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/feed/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new FeedStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, FeedQueryResult),
        manage: (input) => call("manage", input, FeedManageResult),
        work: (input) => call("work", input, FeedWorkResult),
    }
}
