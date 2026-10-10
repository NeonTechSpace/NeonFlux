import { PresetApplyResult, PresetPlansResult, type PresetApplyRequest, type PresetPlansRequest } from "@neonflux/contracts/presets"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export { PRESET_NAMES as presetNames } from "@neonflux/contracts/presets"

export class PresetStoreError extends Data.TaggedError("PresetStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface PresetStore {
    plans(input: PresetPlansRequest): Effect.Effect<PresetPlansResult, PresetStoreError>
    apply(input: PresetApplyRequest): Effect.Effect<PresetApplyResult, PresetStoreError>
}
export function createPresetStore(config: BackendConfig): PresetStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/preset/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new PresetStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        plans: input => call("plans", input, PresetPlansResult),
        apply: input => call("apply", input, PresetApplyResult),
    }
}
