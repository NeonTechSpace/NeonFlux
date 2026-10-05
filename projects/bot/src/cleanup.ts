import type * as C from "@neonflux/backend/contracts"
import { MessageOperationError, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import { CleanupEvidenceError, fetchCleanupMessage } from "./cleanup-evidence.ts"
import { readCleanupAutomationContext } from "./cleanup-permissions.ts"
import { cleanupTargetBinding, type CleanupStore } from "./cleanup-store.ts"

export class CleanupHandlingError extends Data.TaggedError("CleanupHandlingError")<{ readonly stage: "response" | "grant" | "eligibility" | "claim" }> {}
type CleanupOutcome = "deleted" | "failed" | "uncertain" | "absent" | "skipped"
const deleteFailure = (cause: Cause.Cause<unknown>, outcome: "notDispatched" | "rejected") => cause.reasons.length > 0
    && cause.reasons.every(r => r._tag === "Fail" && r.error instanceof MessageOperationError && r.error.operation === "delete" && r.error.outcome === outcome)
/** Reserve, then claim once. The atomic claim is the final backend eligibility check before the delete */
export function processCleanupTarget(store: CleanupStore, serverId: string, client: Client, policy: C.CleanupPolicy, target: C.CleanupTarget) {
    return Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const binding = cleanupTargetBinding(target)
        let claimRequested = false, ownsClaim = false, invoked = false, settledByBackend = false
        let outcome: CleanupOutcome = "failed"
        let observed: C.CleanupObservation | undefined
        const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
        const settled = (value: C.CleanupWorkResult) => value.type === "target" && value.target.state === "skipped" && !!value.target.noDispatch
        const write = Effect.gen(function* () {
            if (target.channelId !== policy.channelId || target.policyRevision !== policy.revision || target.claimedAt !== undefined
                || target.state !== "queued" && target.state !== "reserved") return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" }))
            const context = yield* readCleanupAutomationContext(client, serverId, target.channelId)
            const message = yield* fetchCleanupMessage(client, target.channelId, target.messageId, serverId).pipe(Effect.catch(error => Effect.gen(function* () {
                if (error instanceof CleanupEvidenceError && error.stage === "absent")
                    observed = { originServerId: context.originServerId!, messageId: target.messageId, channelId: target.channelId, observedAt: yield* Clock.currentTimeMillis, status: "absent", channelVisible: true }
                return yield* Effect.fail(error)
            })))
            const reserved = yield* store.work({ serverId, operation: { type: "reserve", binding, message, context } })
            if (settled(reserved)) { settledByBackend = true; outcome = "skipped"; return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" })) }
            if (reserved.type !== "reserved") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
            claimRequested = true
            const claim = yield* store.work({ serverId, operation: { type: "claim", binding, context, message, claimToken } })
            if (settled(claim)) { settledByBackend = true; outcome = "skipped"; return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" })) }
            if (claim.type !== "claimed" || !claim.claimed) return yield* Effect.fail(new CleanupHandlingError({ stage: "claim" }))
            ownsClaim = true
            const budget = Math.min(5000, claim.grant.dispatchExpiresAt - (yield* Clock.currentTimeMillis))
            if (budget <= 0) return yield* Effect.fail(new CleanupHandlingError({ stage: "grant" }))
            invoked = true
            yield* client.messages.delete({ channelId: target.channelId, id: target.messageId }, { timeoutMs: budget })
            return "deleted" as const
        })
        const exit = yield* Effect.exit(restore(write))
        if (Exit.isSuccess(exit)) outcome = exit.value
        else if (invoked && deleteFailure(exit.cause, "notDispatched")) invoked = false
        else if (invoked) outcome = deleteFailure(exit.cause, "rejected") ? "failed" : "uncertain"
        else if (observed) outcome = "absent"
        // A lost claim response never grants permission to submit or guess a no-dispatch callback.
        const canRecord = !settledByBackend && (ownsClaim || !claimRequested)
        const recorded = settledByBackend || canRecord && (yield* store.work({ serverId, operation: { type: "outcome", binding, outcome,
            ...(ownsClaim ? { claimToken } : {}), ...(!invoked ? { noDispatch: true as const } : {}), ...(observed ? { observation: observed } : {}) } }).pipe(
            Effect.match({ onFailure: () => false, onSuccess: value => value.type === "target" && value.recorded })))
        if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
        return { outcome, submitted: invoked, acknowledged: outcome === "deleted", recorded,
            unresolved: outcome === "uncertain" || outcome === "failed" && invoked || claimRequested && !ownsClaim && !settledByBackend }
    }))
}
