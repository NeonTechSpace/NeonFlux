import {
    ReminderManageResult,
    ReminderQueryResult,
    ReminderWorkResult,
    type ReminderManageRequest,
    type ReminderQueryRequest,
    type ReminderWorkRequest,
} from "@neonflux/contracts/reminders"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class ReminderStoreError extends Data.TaggedError("ReminderStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface ReminderStore {
    query(input: ReminderQueryRequest): Effect.Effect<ReminderQueryResult, ReminderStoreError>
    manage(input: ReminderManageRequest): Effect.Effect<ReminderManageResult, ReminderStoreError>
    work(input: ReminderWorkRequest): Effect.Effect<ReminderWorkResult, ReminderStoreError>
}
export function createReminderStore(config: BackendConfig): ReminderStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/reminders/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new ReminderStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, ReminderQueryResult),
        manage: (input) => call("manage", input, ReminderManageResult),
        work: (input) => call("work", input, ReminderWorkResult),
    }
}
