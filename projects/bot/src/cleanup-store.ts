import {
    CleanupQueryResult,
    CleanupManageResult,
    CleanupWorkResult,
    type CleanupSweepBinding,
    type CleanupTargetBinding,
    type CleanupManageRequest,
    type CleanupQueryRequest,
    type CleanupWorkRequest,
} from "@neonflux/contracts/cleanup"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export const cleanupSweepBinding = (v: CleanupSweepBinding): CleanupSweepBinding => ({
    channelId: v.channelId,
    policyRevision: v.policyRevision,
    moduleRevision: v.moduleRevision,
    sweepNo: v.sweepNo,
})
export const cleanupTargetBinding = (v: CleanupTargetBinding): CleanupTargetBinding => ({
    ...cleanupSweepBinding(v),
    pageNo: v.pageNo,
    targetNo: v.targetNo,
    messageId: v.messageId,
})
export class CleanupStoreError extends Data.TaggedError("CleanupStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface CleanupStore {
    manage(input: CleanupManageRequest): Effect.Effect<CleanupManageResult, CleanupStoreError>
    query(input: CleanupQueryRequest): Effect.Effect<CleanupQueryResult, CleanupStoreError>
    work(input: CleanupWorkRequest): Effect.Effect<CleanupWorkResult, CleanupStoreError>
}
export function createCleanupStore(config: BackendConfig): CleanupStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/cleanup/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new CleanupStoreError({
                        operation,
                        ...failureFields(error),
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, CleanupQueryResult),
        manage: (input) => call("manage", input, CleanupManageResult),
        work: (input) => call("work", input, CleanupWorkResult),
    }
}
