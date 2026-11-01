import {
    RightsResult,
    RightsStatus,
    RightsSuspendResult,
    type RightsGetRequest,
    type RightsManageRequest,
    type RightsStatusRequest,
    type RightsSuspendRequest,
} from "@neonflux/contracts/rights"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class RightsStoreError extends Data.TaggedError("RightsStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface RightsStore {
    get(input: RightsGetRequest): Effect.Effect<RightsResult, RightsStoreError>
    status(input: RightsStatusRequest): Effect.Effect<RightsStatus, RightsStoreError>
    manage(input: RightsManageRequest): Effect.Effect<RightsResult, RightsStoreError>
    suspend(input: RightsSuspendRequest): Effect.Effect<RightsSuspendResult, RightsStoreError>
}
export function createRightsStore(config: BackendConfig): RightsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, schema: Schema.Codec<A>, input: unknown) =>
        request(`/rights/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError((error) => new RightsStoreError({ operation, ...failureFields(error) })),
        )
    return {
        get: (input) => call("get", RightsResult, input),
        status: (input) => call("status", RightsStatus, input),
        manage: (input) => call("manage", RightsResult, input),
        suspend: (input) => call("suspend", RightsSuspendResult, input),
    }
}
