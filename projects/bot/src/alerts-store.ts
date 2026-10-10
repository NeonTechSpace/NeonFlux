import { AlertsResult, type AlertsGetRequest, type AlertsManageRequest } from "@neonflux/contracts/alerts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class AlertsStoreError extends Data.TaggedError("AlertsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface AlertsStore {
    get(input: AlertsGetRequest): Effect.Effect<AlertsResult, AlertsStoreError>
    manage(input: AlertsManageRequest): Effect.Effect<AlertsResult, AlertsStoreError>
}
export function createAlertsStore(config: BackendConfig): AlertsStore {
    const request = createBackendRequest(config)
    const call = (operation: string, input: unknown) => request(`/alerts/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AlertsResult, { onExcessProperty: "error" })),
        Effect.mapError(error => new AlertsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { get: input => call("get", input), manage: input => call("manage", input) }
}
