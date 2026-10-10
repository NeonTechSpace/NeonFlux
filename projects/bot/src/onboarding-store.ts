import { OnboardingProgress, OnboardingView, type OnboardingGetRequest, type OnboardingManageRequest, type OnboardingMemberRequest } from "@neonflux/contracts/onboarding"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"


export class OnboardingStoreError extends Data.TaggedError("OnboardingStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string | undefined }> {}
export interface OnboardingStore {
    get(input: OnboardingGetRequest): Effect.Effect<OnboardingView, OnboardingStoreError>
    manage(input: OnboardingManageRequest): Effect.Effect<OnboardingView, OnboardingStoreError>
    member(input: OnboardingMemberRequest): Effect.Effect<OnboardingProgress, OnboardingStoreError>
}
export function createOnboardingStore(config: BackendConfig): OnboardingStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/onboarding/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new OnboardingStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null,
            code: "code" in error && typeof error.code === "string" ? error.code : undefined })))
    return {
        get: input => call("get", input, OnboardingView),
        manage: input => call("manage", input, OnboardingView),
        member: input => call("member", input, OnboardingProgress),
    }
}
