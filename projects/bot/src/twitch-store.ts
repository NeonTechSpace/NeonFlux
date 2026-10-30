import {
    TwitchManageResult,
    TwitchQueryResult,
    TwitchWorkResult,
    type TwitchManageRequest,
    type TwitchQueryRequest,
    type TwitchWorkRequest,
} from "@neonflux/contracts/twitch"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class TwitchStoreError extends Data.TaggedError("TwitchStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface TwitchStore {
    query(input: TwitchQueryRequest): Effect.Effect<TwitchQueryResult, TwitchStoreError>
    manage(input: TwitchManageRequest): Effect.Effect<TwitchManageResult, TwitchStoreError>
    work(input: TwitchWorkRequest): Effect.Effect<TwitchWorkResult, TwitchStoreError>
}
export function createTwitchStore(config: BackendConfig): TwitchStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/twitch/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new TwitchStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, TwitchQueryResult),
        manage: (input) => call("manage", input, TwitchManageResult),
        work: (input) => call("work", input, TwitchWorkResult),
    }
}
