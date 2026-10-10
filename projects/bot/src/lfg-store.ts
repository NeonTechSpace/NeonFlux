import { LfgManageResult, LfgQueryResult, LfgWorkResult, type LfgManageRequest, type LfgQueryRequest, type LfgWorkRequest } from "@neonflux/contracts/lfg"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class LfgStoreError extends Data.TaggedError("LfgStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface LfgStore {
    query(input: LfgQueryRequest): Effect.Effect<LfgQueryResult, LfgStoreError>
    manage(input: LfgManageRequest): Effect.Effect<LfgManageResult, LfgStoreError>
    work(input: LfgWorkRequest): Effect.Effect<LfgWorkResult, LfgStoreError>
}
export function createLfgStore(config: BackendConfig): LfgStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/lfg/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new LfgStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, LfgQueryResult),
        manage: input => call("manage", input, LfgManageResult),
        work: input => call("work", input, LfgWorkResult),
    }
}
