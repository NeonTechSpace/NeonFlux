import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const count = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const settingsSchema = Schema.Struct({ enabled: Schema.Boolean })
const recordSchema = Schema.Struct({ enabled: Schema.Boolean, recorded: Schema.Boolean })
const hour = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0 && v <= 23))
const summarySchema = Schema.Struct({ enabled: Schema.Boolean, since: count, joins: count, leaves: count, messages: count,
    topChannels: Schema.mutable(Schema.Array(Schema.Struct({ channelId: id, count })).check(Schema.isMaxLength(3))),
    busiestHours: Schema.mutable(Schema.Array(Schema.Struct({ hour, count })).check(Schema.isMaxLength(3))) })

export class AnalyticsStoreError extends Data.TaggedError("AnalyticsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface AnalyticsStore {
    settings(input: C.AnalyticsSettingsRequest): Effect.Effect<C.AnalyticsSettings, AnalyticsStoreError>
    manage(input: C.AnalyticsManageRequest): Effect.Effect<C.AnalyticsSettings, AnalyticsStoreError>
    record(input: C.AnalyticsRecordRequest): Effect.Effect<C.AnalyticsRecordResult, AnalyticsStoreError>
    summary(input: C.AnalyticsSummaryRequest): Effect.Effect<C.AnalyticsSummary, AnalyticsStoreError>
}
export function createAnalyticsStore(config: BackendConfig): AnalyticsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/analytics/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new AnalyticsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        settings: input => call("settings", input, settingsSchema),
        manage: input => call("manage", input, settingsSchema),
        record: input => call("record", input, recordSchema),
        summary: input => call("summary", input, summarySchema),
    }
}
