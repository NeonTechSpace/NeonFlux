import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const expected = Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(50))
export const alertSettingsSchema = Schema.Struct({ invites: Schema.Boolean, bots: Schema.Boolean, webhooks: Schema.Boolean, privileges: Schema.Boolean, impersonation: Schema.Boolean,
    expectedBotIds: expected, expectedWebhookIds: expected })
const resultSchema = Schema.Struct({ settings: alertSettingsSchema })

export class AlertsStoreError extends Data.TaggedError("AlertsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface AlertsStore {
    get(input: C.AlertsGetRequest): Effect.Effect<C.AlertsResult, AlertsStoreError>
    manage(input: C.AlertsManageRequest): Effect.Effect<C.AlertsResult, AlertsStoreError>
}
export function createAlertsStore(config: BackendConfig): AlertsStore {
    const request = createBackendRequest(config)
    const call = (operation: string, input: unknown) => request(`/alerts/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(resultSchema, { onExcessProperty: "error" })),
        Effect.mapError(error => new AlertsStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { get: input => call("get", input), manage: input => call("manage", input) }
}
