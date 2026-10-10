import type * as C from "@neonflux/backend/contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export const presetNames = ["gaming", "support", "creator", "relaxed", "balanced", "strict"] as const satisfies readonly C.PresetName[]
const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
export const presetPlanSchema = Schema.Struct({ name: Schema.Literals(presetNames), kind: Schema.Literals(["community", "security"]), description: text,
    changes: Schema.mutable(Schema.Array(Schema.Struct({ family: Schema.Literals(["moderation", "leveling", "tickets", "events"]), setting: text, from: text, to: text }))).check(Schema.isMaxLength(30)),
    token: Schema.String.check(Schema.makeFilter(v => /^[a-f0-9]{8}$/.test(v))) })

export class PresetStoreError extends Data.TaggedError("PresetStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface PresetStore {
    plans(input: C.PresetPlansRequest): Effect.Effect<C.PresetPlansResult, PresetStoreError>
    apply(input: C.PresetApplyRequest): Effect.Effect<C.PresetApplyResult, PresetStoreError>
}
export function createPresetStore(config: BackendConfig): PresetStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/preset/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new PresetStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        plans: input => call("plans", input, Schema.Struct({ presets: Schema.mutable(Schema.Array(presetPlanSchema)).check(Schema.isMaxLength(6)) })) as Effect.Effect<C.PresetPlansResult, PresetStoreError>,
        apply: input => call("apply", input, Schema.Struct({ plan: presetPlanSchema })) as Effect.Effect<C.PresetApplyResult, PresetStoreError>,
    }
}
