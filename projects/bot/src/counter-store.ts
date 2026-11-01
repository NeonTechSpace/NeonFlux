import {
    CounterView,
    CounterWorkResult,
    type CounterManageRequest,
    type CounterQueryRequest,
    type CounterWorkRequest,
} from "@neonflux/contracts/counters"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class CounterStoreError extends Data.TaggedError("CounterStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface CounterStore {
    query(input: CounterQueryRequest): Effect.Effect<CounterView, CounterStoreError>
    manage(input: CounterManageRequest): Effect.Effect<CounterView, CounterStoreError>
    work(input: CounterWorkRequest): Effect.Effect<CounterWorkResult, CounterStoreError>
}
export function createCounterStore(config: BackendConfig): CounterStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/counters/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new CounterStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, CounterView),
        manage: (input) => call("manage", input, CounterView),
        work: (input) => call("work", input, CounterWorkResult),
    }
}
