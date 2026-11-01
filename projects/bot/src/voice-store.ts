import {
    VoiceManageResult,
    VoiceMemberFinishResult,
    VoiceMemberReadyResult,
    VoiceMemberStartResult,
    VoiceQueryResult,
    VoiceRoomsResult,
    type VoiceManageRequest,
    type VoiceMemberFinishRequest,
    type VoiceMemberReadyRequest,
    type VoiceMemberStartRequest,
    type VoiceQueryRequest,
    type VoiceRoomsRequest,
} from "@neonflux/contracts/voice"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class VoiceStoreError extends Data.TaggedError("VoiceStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface VoiceStore {
    query(input: VoiceQueryRequest): Effect.Effect<VoiceQueryResult, VoiceStoreError>
    manage(input: VoiceManageRequest): Effect.Effect<VoiceManageResult, VoiceStoreError>
    rooms(input: VoiceRoomsRequest): Effect.Effect<VoiceRoomsResult, VoiceStoreError>
    memberReady(input: VoiceMemberReadyRequest): Effect.Effect<VoiceMemberReadyResult, VoiceStoreError>
    memberStart(input: VoiceMemberStartRequest): Effect.Effect<VoiceMemberStartResult, VoiceStoreError>
    memberFinish(input: VoiceMemberFinishRequest): Effect.Effect<VoiceMemberFinishResult, VoiceStoreError>
}
export function createVoiceStore(config: BackendConfig): VoiceStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/voice/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new VoiceStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, VoiceQueryResult),
        manage: (input) => call("manage", input, VoiceManageResult),
        rooms: (input) => call("rooms", input, VoiceRoomsResult),
        memberReady: (input) => call("member-ready", input, VoiceMemberReadyResult),
        memberStart: (input) => call("member-start", input, VoiceMemberStartResult),
        memberFinish: (input) => call("member-finish", input, VoiceMemberFinishResult),
    }
}
