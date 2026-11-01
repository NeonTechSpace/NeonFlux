import {
    AntiNukeFinishResult,
    AntiNukeIncidentsResult,
    AntiNukeObserveResult,
    AntiNukeOpenResult,
    AntiNukeResult,
    type AntiNukeFinishRequest,
    type AntiNukeGetRequest,
    type AntiNukeIncidentsRequest,
    type AntiNukeManageRequest,
    type AntiNukeObserveRequest,
    type AntiNukeOpenRequest,
} from "@neonflux/contracts/anti-nuke"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class AntiNukeStoreError extends Data.TaggedError("AntiNukeStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface AntiNukeStore {
    get(input: AntiNukeGetRequest): Effect.Effect<AntiNukeResult, AntiNukeStoreError>
    manage(input: AntiNukeManageRequest): Effect.Effect<AntiNukeResult, AntiNukeStoreError>
    open(input: AntiNukeOpenRequest): Effect.Effect<AntiNukeOpenResult, AntiNukeStoreError>
    finish(input: AntiNukeFinishRequest): Effect.Effect<AntiNukeFinishResult, AntiNukeStoreError>
    observe(input: AntiNukeObserveRequest): Effect.Effect<AntiNukeObserveResult, AntiNukeStoreError>
    incidents(input: AntiNukeIncidentsRequest): Effect.Effect<AntiNukeIncidentsResult, AntiNukeStoreError>
}
export function createAntiNukeStore(config: BackendConfig): AntiNukeStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, schema: Schema.Codec<A>, input: unknown) =>
        request(`/antinuke/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new AntiNukeStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        get: (input) => call("get", AntiNukeResult, input),
        manage: (input) => call("manage", AntiNukeResult, input),
        open: (input) => call("open", AntiNukeOpenResult, input),
        finish: (input) => call("finish", AntiNukeFinishResult, input),
        observe: (input) => call("observe", AntiNukeObserveResult, input),
        incidents: (input) => call("incidents", AntiNukeIncidentsResult, input),
    }
}
