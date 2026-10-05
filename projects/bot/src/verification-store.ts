import type * as C from "@neonflux/backend/contracts"
import type { VerificationIssueRequest, VerificationIssueResult, VerificationReady, VerificationClaimResult } from "@neonflux/backend/verification-contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const key = Schema.String.check(Schema.makeFilter(value => value.length > 0 && value.length <= 256))
const id = Schema.String.check(Schema.makeFilter(value => /^[1-9]\d{0,18}$/.test(value)))
const integer = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const optional = Schema.optionalKey
const issue = Schema.Struct({ issued: Schema.Boolean, challengeId: optional(key), expiresAt: optional(integer) }).check(Schema.makeFilter(value => value.issued === (value.challengeId !== undefined && value.expiresAt !== undefined)))
const ready = Schema.Struct({ requests: Schema.mutable(Schema.Array(Schema.Struct({ challengeId: key, userId: id, joinedAt: key, panelName: key, revision: integer, messageId: id }))).check(Schema.isMaxLength(10)) })
const claim = Schema.Struct({ claimed: Schema.Boolean, sourceId: optional(key), createdAt: optional(integer) }).check(Schema.makeFilter(value => value.claimed === (value.sourceId !== undefined && value.createdAt !== undefined)))
const recorded = Schema.Struct({ recorded: Schema.Boolean })
const requestView = Schema.Struct({ challengeId: key, userId: id, joinedAt: key, panelName: key, revision: integer, messageId: id })
export class VerificationStoreError extends Data.TaggedError("VerificationStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface VerificationStore {
    issue(input: VerificationIssueRequest): Effect.Effect<VerificationIssueResult, VerificationStoreError>
    ready(input: { serverId: string }): Effect.Effect<{ requests: VerificationReady[] }, VerificationStoreError>
    claim(input: { serverId: string, challengeId: string, claimToken: string, context: C.RolesMemberContext, panelVerified: true }): Effect.Effect<VerificationClaimResult, VerificationStoreError>
    delivery(input: { serverId: string, challengeId: string, outcome: "succeeded" | "failed" }): Effect.Effect<{ recorded: boolean }, VerificationStoreError>
    request(input: { serverId: string, challengeId: string }): Effect.Effect<VerificationReady, VerificationStoreError>
    review(input: { serverId: string, challengeId: string, context: C.RolesMemberContext, actor: C.ModerationActor, panelVerified: true }): Effect.Effect<{ reviewed: boolean }, VerificationStoreError>
}
export function createVerificationStore(config: BackendConfig): VerificationStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, codec: Schema.Codec<A>) => request(`/verification/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(codec, { onExcessProperty: "error" })),
        Effect.mapError(error => new VerificationStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { issue: input => call("issue", input, issue), ready: input => call("ready", input, ready), claim: input => call("claim", input, claim), delivery: input => call("delivery", input, recorded),
        request: input => call("request", input, requestView), review: input => call("review", input, Schema.Struct({ reviewed: Schema.Boolean })) }
}
