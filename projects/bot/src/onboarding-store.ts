import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const integer = (min = 0) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min))
const name = Schema.String.check(Schema.makeFilter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)))
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
export const onboardingStepSchema = Schema.Union([Schema.Struct({ type: Schema.Literal("rules") }), Schema.Struct({ type: Schema.Literals(["panel", "menu"]), name }),
    Schema.Struct({ type: Schema.Literal("link"), channelId: id, text: text(100) })])
const settingsSchema = Schema.Struct({ enabled: Schema.Boolean, delivery: Schema.Literals(["welcome", "dm"]), steps: Schema.mutable(Schema.Array(onboardingStepSchema)).check(Schema.isMaxLength(5)),
    completionRoleId: Schema.NullOr(id) })
const viewSchema = Schema.Struct({ revision: integer(), settings: settingsSchema, roleSteps: Schema.mutable(Schema.Array(Schema.mutable(Schema.Array(id)))).check(Schema.isMaxLength(5)) })
const progressSchema = Schema.Struct({ enabled: Schema.Boolean, steps: Schema.mutable(Schema.Array(Schema.Struct({ text: text(300), state: Schema.Literals(["done", "open", "info"]) }))).check(Schema.isMaxLength(5)),
    complete: Schema.Boolean, completedAt: Schema.optionalKey(integer()), grant: Schema.optionalKey(Schema.Struct({ sourceId: Schema.String, roleId: id })) })

export class OnboardingStoreError extends Data.TaggedError("OnboardingStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string | undefined }> {}
export interface OnboardingStore {
    get(input: C.OnboardingGetRequest): Effect.Effect<C.OnboardingView, OnboardingStoreError>
    manage(input: C.OnboardingManageRequest): Effect.Effect<C.OnboardingView, OnboardingStoreError>
    member(input: C.OnboardingMemberRequest): Effect.Effect<C.OnboardingProgress, OnboardingStoreError>
}
export function createOnboardingStore(config: BackendConfig): OnboardingStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/onboarding/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new OnboardingStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null,
            code: "code" in error && typeof error.code === "string" ? error.code : undefined })))
    return {
        get: input => call("get", input, viewSchema) as Effect.Effect<C.OnboardingView, OnboardingStoreError>,
        manage: input => call("manage", input, viewSchema) as Effect.Effect<C.OnboardingView, OnboardingStoreError>,
        member: input => call("member", input, progressSchema) as Effect.Effect<C.OnboardingProgress, OnboardingStoreError>,
    }
}
