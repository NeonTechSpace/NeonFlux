import { CleanupQueryResult, CleanupManageResult, CleanupWorkResult, type CleanupSweepBinding, type CleanupTargetBinding, type CleanupManageRequest, type CleanupQueryRequest, type CleanupWorkRequest } from "@neonflux/contracts/cleanup"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export { CleanupSettings as cleanupSettingsSchema, CleanupPolicy as cleanupPolicySchema, CleanupMessage as cleanupMessageSchema, CleanupSweep as cleanupSweepSchema, CleanupPage as cleanupPageSchema, CleanupGrant as cleanupGrantSchema, CleanupTarget as cleanupTargetSchema } from "@neonflux/contracts/cleanup"

export const cleanupSweepBinding = (v: CleanupSweepBinding): CleanupSweepBinding => ({ channelId: v.channelId, policyRevision: v.policyRevision, moduleRevision: v.moduleRevision, sweepNo: v.sweepNo })
export const cleanupTargetBinding = (v: CleanupTargetBinding): CleanupTargetBinding => ({ ...cleanupSweepBinding(v), pageNo: v.pageNo, targetNo: v.targetNo, messageId: v.messageId })
export const sameCleanupSweep = (a: CleanupSweepBinding, b: CleanupSweepBinding) => a.channelId === b.channelId && a.policyRevision === b.policyRevision && a.moduleRevision === b.moduleRevision && a.sweepNo === b.sweepNo
export function sameCleanupBinding(a: CleanupTargetBinding, b: CleanupTargetBinding) { return sameCleanupSweep(a, b) && a.pageNo === b.pageNo && a.targetNo === b.targetNo && a.messageId === b.messageId }
export class CleanupStoreError extends Data.TaggedError("CleanupStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface CleanupStore {
    manage(input: CleanupManageRequest): Effect.Effect<CleanupManageResult, CleanupStoreError>
    query(input: CleanupQueryRequest): Effect.Effect<CleanupQueryResult, CleanupStoreError>
    work(input: CleanupWorkRequest): Effect.Effect<CleanupWorkResult, CleanupStoreError>
}
export function createCleanupStore(config: BackendConfig): CleanupStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/cleanup/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new CleanupStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, CleanupQueryResult),
        manage: input => call("manage", input, CleanupManageResult),
        work: input => call("work", input, CleanupWorkResult),
    }
}
