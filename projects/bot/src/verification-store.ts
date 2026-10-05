import { VerificationClaimResult, VerificationDeliveryResult, VerificationIssueResult, VerificationReady, VerificationReadyResult, VerificationReviewResult, type VerificationClaimRequest,
    type VerificationDeliveryRequest, type VerificationIssueRequest, type VerificationReadyRequest, type VerificationRequestRequest, type VerificationReviewRequest } from "@neonflux/contracts/verification"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class VerificationStoreError extends Data.TaggedError("VerificationStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface VerificationStore {
    issue(input: VerificationIssueRequest): Effect.Effect<VerificationIssueResult, VerificationStoreError>
    ready(input: VerificationReadyRequest): Effect.Effect<VerificationReadyResult, VerificationStoreError>
    claim(input: VerificationClaimRequest): Effect.Effect<VerificationClaimResult, VerificationStoreError>
    delivery(input: VerificationDeliveryRequest): Effect.Effect<VerificationDeliveryResult, VerificationStoreError>
    request(input: VerificationRequestRequest): Effect.Effect<VerificationReady, VerificationStoreError>
    review(input: VerificationReviewRequest): Effect.Effect<VerificationReviewResult, VerificationStoreError>
}
export function createVerificationStore(config: BackendConfig): VerificationStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, codec: Schema.Codec<A>) => request(`/verification/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(codec, { onExcessProperty: "error" })),
        Effect.mapError(error => new VerificationStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { issue: input => call("issue", input, VerificationIssueResult), ready: input => call("ready", input, VerificationReadyResult), claim: input => call("claim", input, VerificationClaimResult),
        delivery: input => call("delivery", input, VerificationDeliveryResult), request: input => call("request", input, VerificationReady), review: input => call("review", input, VerificationReviewResult) }
}
