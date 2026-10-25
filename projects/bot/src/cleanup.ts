import {
    sameCleanupBinding,
    type CleanupGrant,
    type CleanupPolicy,
    type CleanupTarget,
    type CleanupObservation,
    type CleanupWorkResult,
} from "@neonflux/contracts/cleanup"
import { errors, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import { CleanupEvidenceError, fetchCleanupMessage } from "./cleanup-evidence.ts"
import { readCleanupAutomationContext } from "./cleanup-permissions.ts"
import { cleanupTargetBinding, type CleanupStore } from "./cleanup-store.ts"

export class CleanupHandlingError extends Data.TaggedError("CleanupHandlingError")<{
    readonly stage: "response" | "grant" | "eligibility" | "claim"
}> {}
type CleanupOutcome = "deleted" | "failed" | "uncertain" | "absent" | "skipped"
/** Claim once. The atomic claim reserves the target and is the final backend eligibility check before the delete */
export function processCleanupTarget(
    store: CleanupStore,
    serverId: string,
    client: Client,
    policy: CleanupPolicy,
    target: CleanupTarget,
) {
    return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
            const binding = cleanupTargetBinding(target)
            let claimRequested = false,
                ownsClaim = false,
                invoked = false,
                settledByBackend = false
            let outcome: CleanupOutcome = "failed"
            let observed: CleanupObservation | undefined
            const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
            const settled = (value: CleanupWorkResult) =>
                value.type === "target" && value.target.state === "skipped" && !!value.target.noDispatch
            const write = Effect.gen(function* () {
                if (
                    target.channelId !== policy.channelId ||
                    target.policyRevision !== policy.revision ||
                    target.claimedAt !== undefined ||
                    (target.state !== "queued" && target.state !== "reserved")
                )
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" }))
                const context = yield* readCleanupAutomationContext(client, serverId, target.channelId)
                const message = yield* fetchCleanupMessage(
                    client,
                    target.threadId ?? target.channelId,
                    target.messageId,
                    serverId,
                    target.threadId ? target.channelId : undefined,
                ).pipe(
                    Effect.catch((error) =>
                        Effect.gen(function* () {
                            if (error instanceof CleanupEvidenceError && error.stage === "absent")
                                observed = {
                                    originServerId: context.originServerId!,
                                    messageId: target.messageId,
                                    channelId: target.channelId,
                                    observedAt: yield* Clock.currentTimeMillis,
                                    status: "absent",
                                    channelVisible: true,
                                }
                            return yield* Effect.fail(error)
                        }),
                    ),
                )
                claimRequested = true
                const claim = yield* store.work({
                    serverId,
                    operation: { type: "claim", binding, context, message, claimToken },
                })
                if (settled(claim)) {
                    settledByBackend = true
                    outcome = "skipped"
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" }))
                }
                if (claim.type !== "claimed" || !claim.claimed)
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "claim" }))
                ownsClaim = true
                const budget = Math.min(5000, claim.grant.dispatchExpiresAt - (yield* Clock.currentTimeMillis))
                if (budget <= 0) return yield* Effect.fail(new CleanupHandlingError({ stage: "grant" }))
                invoked = true
                yield* client.messages.delete(
                    { channelId: target.threadId ?? target.channelId, id: target.messageId },
                    { timeoutMs: budget },
                )
                return "deleted" as const
            })
            const exit = yield* Effect.exit(restore(write))
            if (Exit.isSuccess(exit)) outcome = exit.value
            else if (invoked && errors.outcome(exit.cause) === "notDispatched") invoked = false
            else if (invoked) outcome = errors.outcome(exit.cause) === "rejected" ? "failed" : "uncertain"
            else if (observed) outcome = "absent"
            // A lost claim response never grants permission to submit or guess a no-dispatch callback.
            const canRecord = !settledByBackend && (ownsClaim || !claimRequested)
            const recorded =
                settledByBackend ||
                (canRecord &&
                    (yield* store
                        .work({
                            serverId,
                            operation: {
                                type: "outcome",
                                binding,
                                outcome,
                                ...(ownsClaim ? { claimToken } : {}),
                                ...(!invoked ? { noDispatch: true as const } : {}),
                                ...(observed ? { observation: observed } : {}),
                            },
                        })
                        .pipe(
                            Effect.match({
                                onFailure: () => false,
                                onSuccess: (value) => value.type === "target" && value.recorded,
                            }),
                        )))
            if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
            return {
                outcome,
                submitted: invoked,
                acknowledged: outcome === "deleted",
                recorded,
                unresolved:
                    outcome === "uncertain" ||
                    (outcome === "failed" && invoked) ||
                    (claimRequested && !ownsClaim && !settledByBackend),
            }
        }),
    )
}

/** How long a page's message facts stay fresh enough to delete from them without reading each message again. The backend refuses older facts at 60 seconds */
export const cleanupBatchFreshMs = 50000
/** Whether a target's message facts were read in the sweep step that just saved or returned its page */
export const cleanupBatchable = (target: CleanupTarget, policy: CleanupPolicy, now: number) =>
    target.state === "queued" &&
    target.claimedAt === undefined &&
    target.channelId === policy.channelId &&
    target.policyRevision === policy.revision &&
    now - target.message.observedAt <= cleanupBatchFreshMs

/**
 * Deletes the targets of one page that were read moments ago with one bulk request: one claim for all of them, one request, one
 * outcome for all of them. The claim is the final backend eligibility check, so a target that turned ineligible or that another
 * claim holds is left out. A bulk request is never sent twice. Before the claim, a failure leaves every target queued for the
 * next pass. A claim whose answer was lost never gets an outcome, and the backend settles those targets as uncertain when the
 * grant ends
 */
export function processCleanupBatch(
    store: CleanupStore,
    serverId: string,
    client: Client,
    policy: CleanupPolicy,
    targets: readonly CleanupTarget[],
) {
    return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
            let claimRequested = false,
                grants: readonly CleanupGrant[] = [],
                invoked = false
            let outcome: "deleted" | "failed" | "uncertain" = "failed"
            const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
            const channelId = targets[0]!.threadId ?? targets[0]!.channelId
            const write = Effect.gen(function* () {
                if (targets.some((target) => (target.threadId ?? target.channelId) !== channelId))
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" }))
                const context = yield* readCleanupAutomationContext(client, serverId, policy.channelId)
                claimRequested = true
                const claim = yield* store.work({
                    serverId,
                    operation: {
                        type: "claim-batch",
                        items: targets.map((target) => ({
                            binding: cleanupTargetBinding(target),
                            message: target.message,
                        })),
                        context,
                        claimToken,
                    },
                })
                if (claim.type !== "claimed-batch")
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                // Every grant must be one of the targets asked for, so nothing else is ever deleted
                if (
                    claim.grants.some((grant) => !targets.some((target) => sameCleanupBinding(target, grant))) ||
                    new Set(claim.grants.map((grant) => grant.messageId)).size !== claim.grants.length
                )
                    return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                grants = claim.grants
                if (!grants.length) return
                const budget = Math.min(
                    5000,
                    Math.min(...grants.map((grant) => grant.dispatchExpiresAt)) - (yield* Clock.currentTimeMillis),
                )
                if (budget <= 0) return yield* Effect.fail(new CleanupHandlingError({ stage: "grant" }))
                invoked = true
                yield* client.messages.deleteMany(
                    channelId,
                    grants.map((grant) => grant.messageId),
                    { timeoutMs: budget },
                )
                return "deleted" as const
            })
            const exit = yield* Effect.exit(restore(write))
            if (Exit.isSuccess(exit)) outcome = exit.value ?? outcome
            else {
                if (invoked && errors.outcome(exit.cause) === "notDispatched") invoked = false
                else if (invoked) outcome = errors.outcome(exit.cause) === "rejected" ? "failed" : "uncertain"
            }
            // The claim's answer never arrived, so the request cannot say which targets it holds
            const lostClaim = claimRequested && Exit.isFailure(exit) && !grants.length && !invoked
            const recorded =
                grants.length > 0 &&
                (yield* store
                    .work({
                        serverId,
                        operation: {
                            type: "outcome-batch",
                            bindings: grants.map(cleanupTargetBinding),
                            outcome,
                            claimToken,
                            ...(!invoked ? { noDispatch: true as const } : {}),
                        },
                    })
                    .pipe(
                        Effect.match({
                            onFailure: () => false,
                            onSuccess: (value) => value.type === "outcome-batch" && value.recorded === grants.length,
                        }),
                    ))
            if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
            return {
                outcome,
                attempted: grants.length,
                submitted: invoked ? grants.length : 0,
                acknowledged: outcome === "deleted" ? grants.length : 0,
                recorded,
                unresolved:
                    outcome === "uncertain" || (outcome === "failed" && invoked)
                        ? grants.length
                        : lostClaim
                          ? targets.length
                          : 0,
            }
        }),
    )
}
