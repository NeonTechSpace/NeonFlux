import {
    AlertsActionClaimResult,
    AlertsActionOutcomeResult,
    AlertsActionsObserveResult,
    AlertsResult,
    type AlertsActionClaimRequest,
    type AlertsActionOutcomeRequest,
    type AlertsActionsObserveRequest,
    type AlertsGetRequest,
    type AlertsManageRequest,
} from "@neonflux/contracts/alerts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class AlertsStoreError extends Data.TaggedError("AlertsStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface AlertsStore {
    get(input: AlertsGetRequest): Effect.Effect<AlertsResult, AlertsStoreError>
    manage(input: AlertsManageRequest): Effect.Effect<AlertsResult, AlertsStoreError>
    claimAction(input: AlertsActionClaimRequest): Effect.Effect<AlertsActionClaimResult, AlertsStoreError>
    actionOutcome(input: AlertsActionOutcomeRequest): Effect.Effect<AlertsActionOutcomeResult, AlertsStoreError>
    observeActions(input: AlertsActionsObserveRequest): Effect.Effect<AlertsActionsObserveResult, AlertsStoreError>
}
export function createAlertsStore(config: BackendConfig): AlertsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, schema: Schema.Codec<A>, input: unknown) =>
        request(`/alerts/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new AlertsStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        get: (input) => call("get", AlertsResult, input),
        manage: (input) => call("manage", AlertsResult, input),
        claimAction: (input) => call("claim-action", AlertsActionClaimResult, input),
        actionOutcome: (input) => call("action-outcome", AlertsActionOutcomeResult, input),
        observeActions: (input) => call("observe-actions", AlertsActionsObserveResult, input),
    }
}
