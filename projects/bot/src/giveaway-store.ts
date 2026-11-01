import {
    GiveawayManageResult,
    GiveawayQueryResult,
    GiveawayWorkResult,
    type GiveawayManageRequest,
    type GiveawayQueryRequest,
    type GiveawayWorkRequest,
} from "@neonflux/contracts/giveaways"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, failureFields } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class GiveawayStoreError extends Data.TaggedError("GiveawayStoreError")<{
    readonly operation: string
    readonly status: number | null
    readonly code?: string
    readonly reason?: string
}> {}
export interface GiveawayStore {
    query(input: GiveawayQueryRequest): Effect.Effect<GiveawayQueryResult, GiveawayStoreError>
    manage(input: GiveawayManageRequest): Effect.Effect<GiveawayManageResult, GiveawayStoreError>
    work(input: GiveawayWorkRequest): Effect.Effect<GiveawayWorkResult, GiveawayStoreError>
}
export function createGiveawayStore(config: BackendConfig): GiveawayStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/giveaways/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError((error) => new GiveawayStoreError({ operation, ...failureFields(error) })),
        )
    return {
        query: (input) => call("query", input, GiveawayQueryResult),
        manage: (input) => call("manage", input, GiveawayManageResult),
        work: (input) => call("work", input, GiveawayWorkResult),
    }
}
