import { AnalyticsRecordResult, AnalyticsSettings, AnalyticsSummary, type AnalyticsManageRequest, type AnalyticsRecordRequest, type AnalyticsSettingsRequest, type AnalyticsSummaryRequest } from "@neonflux/contracts/analytics"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class AnalyticsStoreError extends Data.TaggedError("AnalyticsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface AnalyticsStore {
    settings(input: AnalyticsSettingsRequest): Effect.Effect<AnalyticsSettings, AnalyticsStoreError>
    manage(input: AnalyticsManageRequest): Effect.Effect<AnalyticsSettings, AnalyticsStoreError>
    record(input: AnalyticsRecordRequest): Effect.Effect<AnalyticsRecordResult, AnalyticsStoreError>
    summary(input: AnalyticsSummaryRequest): Effect.Effect<AnalyticsSummary, AnalyticsStoreError>
}
export function createAnalyticsStore(config: BackendConfig): AnalyticsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/analytics/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new AnalyticsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        settings: input => call("settings", input, AnalyticsSettings),
        manage: input => call("manage", input, AnalyticsSettings),
        record: input => call("record", input, AnalyticsRecordResult),
        summary: input => call("summary", input, AnalyticsSummary),
    }
}
