import {
    JailDueResult,
    JailHeldResult,
    JailListResult,
    JailMemory,
    JailReleaseResult,
    JailReportResult,
    JailResult,
    JailStatus,
    type JailDueRequest,
    type JailHeldRequest,
    type JailListRequest,
    type JailManageRequest,
    type JailMemoryRequest,
    type JailReleaseRequest,
    type JailReportRequest,
    type JailStatusRequest,
} from "@neonflux/contracts/jail"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class JailStoreError extends Data.TaggedError("JailStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface JailStore {
    memory(input: JailMemoryRequest): Effect.Effect<JailMemory, JailStoreError>
    status(input: JailStatusRequest): Effect.Effect<JailStatus, JailStoreError>
    list(input: JailListRequest): Effect.Effect<JailListResult, JailStoreError>
    manage(input: JailManageRequest): Effect.Effect<JailResult, JailStoreError>
    report(input: JailReportRequest): Effect.Effect<JailReportResult, JailStoreError>
    due(input: JailDueRequest): Effect.Effect<JailDueResult, JailStoreError>
    release(input: JailReleaseRequest): Effect.Effect<JailReleaseResult, JailStoreError>
    held(input: JailHeldRequest): Effect.Effect<JailHeldResult, JailStoreError>
}
export function createJailStore(config: BackendConfig): JailStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, schema: Schema.Codec<A>, input: unknown) =>
        request(`/jail/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError((error) => new JailStoreError({ operation, ...failureFields(error) })),
        )
    return {
        memory: (input) => call("memory", JailMemory, input),
        status: (input) => call("status", JailStatus, input),
        list: (input) => call("list", JailListResult, input),
        manage: (input) => call("manage", JailResult, input),
        report: (input) => call("report", JailReportResult, input),
        due: (input) => call("due", JailDueResult, input),
        release: (input) => call("release", JailReleaseResult, input),
        held: (input) => call("held", JailHeldResult, input),
    }
}
