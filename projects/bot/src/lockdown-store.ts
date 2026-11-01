import {
    LockdownResult,
    LockdownStatus,
    LockdownWorkResult,
    type LockdownAutoRequest,
    type LockdownGetRequest,
    type LockdownManageRequest,
    type LockdownWorkRequest,
} from "@neonflux/contracts/lockdown"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class LockdownStoreError extends Data.TaggedError("LockdownStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface LockdownStore {
    get(input: LockdownGetRequest): Effect.Effect<LockdownStatus, LockdownStoreError>
    manage(input: LockdownManageRequest): Effect.Effect<LockdownResult, LockdownStoreError>
    auto(input: LockdownAutoRequest): Effect.Effect<LockdownResult, LockdownStoreError>
    work(input: LockdownWorkRequest): Effect.Effect<LockdownWorkResult, LockdownStoreError>
}
export function createLockdownStore(config: BackendConfig): LockdownStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, schema: Schema.Codec<A>, input: unknown) =>
        request(`/lockdown/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new LockdownStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        get: (input) => call("get", LockdownStatus, input),
        manage: (input) => call("manage", LockdownResult, input),
        auto: (input) => call("auto", LockdownResult, input),
        work: (input) => call("work", LockdownWorkResult, input),
    }
}
