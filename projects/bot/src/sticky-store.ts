import { StickyListResult, StickyManageResult, StickyPostedResult, type StickyListRequest, type StickyManageRequest, type StickyPostedRequest } from "@neonflux/contracts/sticky"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class StickyStoreError extends Data.TaggedError("StickyStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface StickyStore {
    list(input: StickyListRequest): Effect.Effect<StickyListResult, StickyStoreError>
    manage(input: StickyManageRequest): Effect.Effect<StickyManageResult, StickyStoreError>
    posted(input: StickyPostedRequest): Effect.Effect<StickyPostedResult, StickyStoreError>
}
export function createStickyStore(config: BackendConfig): StickyStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/sticky/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new StickyStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        list: input => call("list", input, StickyListResult),
        manage: input => call("manage", input, StickyManageResult),
        posted: input => call("posted", input, StickyPostedResult),
    }
}
