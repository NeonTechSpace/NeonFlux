import { randomUUID } from 'node:crypto';

import {
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    createBlueprintMutationFenceManifest,
    createBlueprintRunVerificationEvidenceDigest,
    deriveBlueprintCursorAuthority,
    toBlueprintSnapshot,
} from '@neonflux/blueprint';
import {
    authorizeBlueprintRunMutation,
    checkpointBlueprintRun,
    claimNextBlueprintRun,
    completeAndCheckpointBlueprintRunStepAttempt,
    ensureBlueprintRunRestorePoint,
    finalizeBlueprintRun,
    prepareBlueprintRunStepAttempt,
    startBlueprintRunStepAttempt,
    type RuntimeDbClient,
    type BlueprintRunStepAttemptRecord,
    type BlueprintRunPhase,
    type BlueprintRunProtocolMismatchRecord,
} from '@neonflux/db';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { verifyProjectedStructureSnapshot } from './bot-blueprint-run-verification.js';
import { toBlueprintApplyAction } from './bot-blueprint-provider-steps.js';
import { validateClaimedBlueprintRunAuthority } from './bot-blueprint-run-authority.js';

const leaseTtlMs = 3 * 60_000;

export type BlueprintRunWorkerResult =
    | 'idle'
    | 'progressed'
    | { kind: 'backend_incompatible' }
    | BlueprintRunProtocolMismatchRecord;

export async function runNextBlueprintRun(input: {
    botToken: string;
    database: RuntimeDbClient;
    leaseOwner: string;
    now?: Date;
}): Promise<BlueprintRunWorkerResult> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextBlueprintRun(input.database.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) {
        if (claim.error.type === 'backend-incompatible') return { kind: 'backend_incompatible' };
        throw new Error('blueprint-run-claim-failed');
    }
    if (!claim.value) return 'idle';
    if (claim.value.kind === 'protocol_mismatch') return claim.value;
    if (claim.value.kind === 'authority_invalid') return 'progressed';
    if (claim.value.run.protocolVersion !== BLUEPRINT_RUN_PROTOCOL_VERSION) {
        return {
            kind: 'protocol_mismatch',
            runId: claim.value.run.id,
            runProtocolVersion: claim.value.run.protocolVersion,
            guildId: claim.value.run.guildId,
            mayHaveExternalEffects: claim.value.run.appliedSteps > 0,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            status: claim.value.run.status,
        };
    }
    const validated = await validateClaimedBlueprintRunAuthority(claim.value);
    const { run } = claim.value;
    if (validated.type === 'invalid') {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: validated.errorType,
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: run.appliedSteps > 0 ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    const { authority, executionAuthority, cursor, steps } = validated.value;
    const attemptCounts = new Map<string, number>();
    const pendingAttempts = new Map<string, BlueprintRunStepAttemptRecord>();
    for (const attempt of claim.value.attempts) {
        attemptCounts.set(attempt.planStepId, Math.max(attemptCounts.get(attempt.planStepId) ?? 0, attempt.attempt));
        const latestPending = pendingAttempts.get(attempt.planStepId);
        if (attempt.state === 'pending' && (!latestPending || attempt.attempt > latestPending.attempt)) {
            pendingAttempts.set(attempt.planStepId, attempt);
        }
    }
    let activeAttempt: BlueprintRunStepAttemptRecord | undefined;
    let activeAttemptStepId: string | undefined;
    let activeAttemptStarted = false;
    let currentStepId: string | undefined;
    const state: {
        controlRequest: 'pause' | 'cancel' | null;
        controlStatus: string;
        atomicCompletionFailed: boolean;
        knownPartialMutation: boolean;
        leaseActive: boolean;
        outcomeUnknown: boolean;
        persistenceFailure?: string;
        rateLimited?: { retryAfterMs: number };
        terminalPersisted: boolean;
    } = {
        controlRequest: null,
        controlStatus: 'running',
        atomicCompletionFailed: false,
        knownPartialMutation: run.appliedSteps > 0,
        leaseActive: true,
        outcomeUnknown: false,
        terminalPersisted: false,
    };
    let appliedSteps = run.appliedSteps;
    let failedSteps = run.failedSteps;
    let completedMutationSteps = run.completedMutationSteps;
    let latestIdMap = cursor.idMap;
    let nextStepSequence = run.nextStepSequence;
    const executableSteps = steps.filter((action) => action.sequence >= run.nextStepSequence);
    const knownTargetKinds = executionAuthority.knownTargetKinds;
    const initialIdMap = executionAuthority.initialIdMap;
    const sourceGuildId = executionAuthority.sourceGuildId;
    const referenceValidation = deriveBlueprintCursorAuthority({
        actions: steps.map(toBlueprintApplyAction),
        cursor: run.nextStepSequence,
        runIdMap: cursor.idMap,
        guildId: run.guildId,
        initialIdMap,
        knownTargetKinds,
        ...(sourceGuildId ? { sourceGuildId } : {}),
    });
    if (!referenceValidation.ok) {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: `${referenceValidation.errorType}:${referenceValidation.actionId}`,
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: run.appliedSteps > 0 ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    if (!run.restorePointBackupId) {
        const restoreSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: run.guildId,
        });
        if (restoreSnapshot.isErr()) {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: 'restore-point-read-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const restoreObservedAt = new Date();
        const restoreStructure = toBlueprintSnapshot(restoreSnapshot.value, restoreObservedAt.toISOString());
        const restorePoint = await ensureBlueprintRunRestorePoint(input.database.db, {
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            observedAt: restoreObservedAt,
            structure: toJsonRecord(restoreStructure),
        });
        if (restorePoint.isErr()) {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: 'restore-point-persist-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
    }
    if (run.nextStepSequence === 0 && run.appliedSteps === 0 && run.completedMutationSteps === 0) {
        const authorizationSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: run.guildId,
        });
        if (authorizationSnapshot.isErr()) {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: 'pre-mutation-live-read-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const authorizationObservedAt = new Date();
        const authorizationStructure = toBlueprintSnapshot(
            authorizationSnapshot.value,
            authorizationObservedAt.toISOString()
        );
        let authorizationManifest;
        try {
            authorizationManifest = await createBlueprintMutationFenceManifest(authorizationStructure);
        } catch (error) {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: readMutationFenceConstructionError(error),
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const authorization = await authorizeBlueprintRunMutation(input.database.db, {
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            manifest: toJsonRecord(authorizationManifest),
            now: new Date(),
            observedAt: authorizationObservedAt,
            structure: authorizationStructure,
        });
        if (authorization.isErr()) {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: 'pre-mutation-authorization-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        if (authorization.value.kind === 'rejected') return 'progressed';
    }
    let result: Awaited<ReturnType<typeof applyFluxerBotGuildStructureActions>>;
    try {
        result = await applyFluxerBotGuildStructureActions({
            botToken: input.botToken,
            guildId: run.guildId,
            actions: executableSteps.map(toBlueprintApplyAction),
            idMap: latestIdMap,
            knownTargetKinds: referenceValidation.knownTargetKinds,
            referenceIdMap: referenceValidation.idMap,
            ...(sourceGuildId ? { sourceGuildId } : {}),
            beforeAction: async (action) => {
                if (activeAttempt) {
                    if (activeAttemptStarted) state.outcomeUnknown = true;
                    else state.persistenceFailure = 'attempt-not-completed';
                    return false;
                }
                const persistedStep = steps.find((candidate) => candidate.id === action.id);
                if (persistedStep?.sequence !== nextStepSequence) {
                    state.persistenceFailure = 'blueprint-run-step-sequence-invalid';
                    return false;
                }
                const pendingAttempt = pendingAttempts.get(action.id);
                const attempt = pendingAttempt?.attempt ?? (attemptCounts.get(action.id) ?? 0) + 1;
                const preparedAt = new Date();
                const prepared = await prepareBlueprintRunStepAttempt(input.database.db, {
                    planStepId: action.id,
                    attempt,
                    runId: run.id,
                    leaseId,
                    leaseExpiresAt: new Date(preparedAt.getTime() + leaseTtlMs),
                    leaseOwner: input.leaseOwner,
                    now: preparedAt,
                    requestKey: pendingAttempt?.requestKey ?? `${run.id}:${action.id}:${String(attempt)}`,
                });
                if (prepared.isErr()) {
                    state.persistenceFailure = 'attempt-prepare-failed';
                    return false;
                }
                state.controlStatus = prepared.value.run.status;
                state.controlRequest = prepared.value.run.controlRequest;
                state.leaseActive = prepared.value.kind === 'prepared' && prepared.value.run.status === 'running';
                if (!state.leaseActive) return false;
                pendingAttempts.delete(action.id);
                attemptCounts.set(action.id, attempt);
                currentStepId = action.id;
                activeAttempt = prepared.value.attempt;
                activeAttemptStepId = action.id;
                activeAttemptStarted = false;
                return true;
            },
            beforeMutation: async () => {
                if (!currentStepId || !activeAttempt || activeAttemptStepId !== currentStepId) {
                    return false;
                }
                if (!activeAttemptStarted) {
                    const startedAt = new Date();
                    const started = await startBlueprintRunStepAttempt(input.database.db, {
                        attemptId: activeAttempt.id,
                        leaseId,
                        leaseExpiresAt: new Date(startedAt.getTime() + leaseTtlMs),
                        leaseOwner: input.leaseOwner,
                        now: startedAt,
                    });
                    if (started.isErr()) {
                        state.persistenceFailure = 'attempt-start-failed';
                        return false;
                    }
                    state.controlStatus = started.value.run.status;
                    state.controlRequest = started.value.run.controlRequest;
                    state.leaseActive = started.value.kind === 'started' && started.value.run.status === 'running';
                    if (!state.leaseActive) return false;
                    activeAttempt = started.value.attempt;
                    activeAttemptStarted = true;
                }
                return true;
            },
            onActionResult: async (actionResult, idMap) => {
                const action = steps.find((candidate) => candidate.id === actionResult.id);
                const attempt = activeAttempt;
                const attemptStarted = activeAttemptStarted;
                const isRateLimited = actionResult.errorType === 'rate-limited';
                const isLeaseLost = actionResult.errorType === 'apply-lease-lost';
                const isOutcomeUnknown = actionResult.status === 'failed' && actionResult.mutationOutcome === 'unknown';
                const isHardFailure =
                    actionResult.status === 'failed' && !isRateLimited && !isLeaseLost && !isOutcomeUnknown;

                if (action?.sequence !== nextStepSequence) {
                    if (attemptStarted) state.outcomeUnknown = true;
                    else state.persistenceFailure = 'step-result-sequence-invalid';
                    return false;
                }
                if (actionResult.status === 'applied') {
                    if (!attemptStarted) {
                        state.persistenceFailure = 'step-applied-without-started-attempt';
                        return false;
                    }
                    appliedSteps += 1;
                    completedMutationSteps += 1;
                    nextStepSequence = action.sequence + 1;
                } else if (isHardFailure) {
                    failedSteps += 1;
                    nextStepSequence = action.sequence + 1;
                }
                if (actionResult.status === 'applied') state.knownPartialMutation = true;
                if (isRateLimited) {
                    state.rateLimited = {
                        retryAfterMs: actionResult.retryAfterMs ?? fallbackRetryAfterMs(action.targetType),
                    };
                }
                if (isLeaseLost) state.leaseActive = false;
                latestIdMap = { ...idMap };

                if (!attempt) {
                    activeAttempt = undefined;
                    activeAttemptStepId = undefined;
                    activeAttemptStarted = false;
                    return false;
                }
                const errorType = isOutcomeUnknown
                    ? `mutation-outcome-unknown:${actionResult.errorType ?? 'operation-failed'}`
                    : actionResult.errorType;
                const requestedStatus = isOutcomeUnknown
                    ? ('outcome_unknown' as const)
                    : isHardFailure
                      ? appliedSteps > 0
                          ? ('partially_applied' as const)
                          : ('failed_before_mutation' as const)
                      : isRateLimited
                        ? ('waiting_rate_limit' as const)
                        : state.controlStatus === 'pause_requested'
                          ? ('pause_requested' as const)
                          : ('running' as const);
                const progress = {
                    appliedSteps,
                    completedMutationSteps,
                    currentStepDomain: action.targetType,
                    currentStepId: action.id,
                    ...(typeof action.details.label === 'string' ? { currentStepLabel: action.details.label } : {}),
                    failedSteps,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    nextStepSequence,
                    notStartedSteps: Math.max(0, steps.length - nextStepSequence),
                    now: new Date(),
                    phase:
                        requestedStatus === 'waiting_rate_limit'
                            ? ('waiting_rate_limit' as const)
                            : requestedStatus === 'partially_applied' ||
                                requestedStatus === 'failed_before_mutation' ||
                                requestedStatus === 'outcome_unknown'
                              ? ('complete' as const)
                              : runPhaseForStep(action.actionType, action.targetType),
                    skippedSteps: 0,
                    status: requestedStatus,
                    totalMutationSteps: run.totalMutationSteps,
                };
                const persisted = await completeBlueprintRunStepAttemptWithRetry(input.database.db, {
                    ...progress,
                    attemptId: attempt.id,
                    ...(actionResult.createdId ? { createdId: actionResult.createdId } : {}),
                    ...(errorType ? { errorType } : {}),
                    ...(isRateLimited && state.rateLimited
                        ? { retryAt: new Date(Date.now() + state.rateLimited.retryAfterMs) }
                        : {}),
                    state: actionResult.status === 'applied' ? 'applied' : isOutcomeUnknown ? 'unknown' : 'failed',
                });
                if (persisted.isErr()) {
                    if (attemptStarted) state.outcomeUnknown = true;
                    else {
                        state.atomicCompletionFailed = true;
                        state.persistenceFailure = 'local-step-result-persistence-failed';
                    }
                } else {
                    state.controlStatus = persisted.value.run.status;
                    state.controlRequest = persisted.value.run.controlRequest;
                    state.leaseActive = persisted.value.run.status === 'running';
                    state.terminalPersisted = [
                        'partially_applied',
                        'failed_before_mutation',
                        'outcome_unknown',
                        'cancelled',
                    ].includes(persisted.value.run.status);
                }
                activeAttempt = undefined;
                activeAttemptStepId = undefined;
                activeAttemptStarted = false;
                return (
                    persisted.isOk() && actionResult.status === 'applied' && persisted.value.run.status === 'running'
                );
            },
        });
    } catch {
        const attempt = activeAttempt;
        const action = currentStepId ? steps.find((candidate) => candidate.id === currentStepId) : undefined;
        if (attempt && action?.sequence === nextStepSequence) {
            const providerOutcomeUnknown = attempt.state === 'started';
            const caughtFailedSteps = providerOutcomeUnknown ? failedSteps : failedSteps + 1;
            const caughtNextStepSequence = providerOutcomeUnknown ? nextStepSequence : action.sequence + 1;
            const persisted = await completeBlueprintRunStepAttemptWithRetry(input.database.db, {
                appliedSteps,
                attemptId: attempt.id,
                completedMutationSteps,
                currentStepDomain: action.targetType,
                currentStepId: action.id,
                ...(typeof action.details.label === 'string' ? { currentStepLabel: action.details.label } : {}),
                errorType: providerOutcomeUnknown ? 'mutation-callback-outcome-unknown' : 'mutation-callback-failed',
                failedSteps: caughtFailedSteps,
                leaseId,
                leaseOwner: input.leaseOwner,
                nextStepSequence: caughtNextStepSequence,
                notStartedSteps: Math.max(0, steps.length - caughtNextStepSequence),
                now: new Date(),
                phase: 'complete',
                skippedSteps: 0,
                state: providerOutcomeUnknown ? 'unknown' : 'failed',
                status: providerOutcomeUnknown
                    ? 'outcome_unknown'
                    : appliedSteps > 0
                      ? 'partially_applied'
                      : 'failed_before_mutation',
                totalMutationSteps: run.totalMutationSteps,
            });
            if (persisted.isOk()) return 'progressed';
        }
        if (activeAttempt?.state === 'started') {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                errorType: 'mutation-callback-outcome-unknown',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'outcome_unknown',
            });
        }
        return 'progressed';
    }
    if (state.terminalPersisted || state.controlStatus === 'cancelled' || state.controlStatus === 'paused') {
        return 'progressed';
    }
    if (state.atomicCompletionFailed) return 'progressed';
    if (state.outcomeUnknown) {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: 'mutation-result-persistence-failed',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: 'outcome_unknown',
        });
        return 'progressed';
    }
    const terminalErrorType = state.persistenceFailure;
    if (terminalErrorType) {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: terminalErrorType,
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    if (state.controlStatus === 'pause_requested') {
        if (state.controlRequest === 'cancel') {
            await persistBlueprintRunTerminalOrThrow(input.database.db, {
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'cancelled',
            });
            return 'progressed';
        }
        await persistBlueprintRunCheckpointOrThrow(input.database.db, {
            appliedSteps,
            completedMutationSteps,
            runId: run.id,
            failedSteps,
            leaseId,
            leaseOwner: input.leaseOwner,
            nextStepSequence,
            notStartedSteps: Math.max(0, steps.length - nextStepSequence),
            now: new Date(),
            phase: 'paused',
            skippedSteps: 0,
            status: 'paused',
            totalMutationSteps: run.totalMutationSteps,
        });
        return 'progressed';
    }
    if (state.rateLimited) return 'progressed';
    if (result.isErr() || !state.leaseActive) {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: result.isErr() ? result.error.type : 'run-control-requested',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    latestIdMap = result.value.idMap;
    const unhandledFailure = result.value.actions.find((action) => action.status === 'failed');
    if (unhandledFailure || nextStepSequence !== steps.length || failedSteps > 0) {
        await persistBlueprintRunTerminalOrThrow(input.database.db, {
            errorType: unhandledFailure?.errorType ?? 'blueprint-run-incomplete',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    const verificationCheckpoint = await checkpointBlueprintRun(input.database.db, {
        appliedSteps,
        completedMutationSteps,
        runId: run.id,
        failedSteps,
        leaseId,
        leaseOwner: input.leaseOwner,
        nextStepSequence,
        notStartedSteps: 0,
        now: new Date(),
        phase: 'verifying',
        skippedSteps: 0,
        status: 'verifying',
        totalMutationSteps: run.totalMutationSteps,
    });
    if (verificationCheckpoint.isErr()) return 'progressed';
    const verification = await verifyProjectedStructureSnapshot(
        input.botToken,
        run.guildId,
        authority.projectedSnapshot,
        latestIdMap
    );
    const verificationEvidenceDigest = await createBlueprintRunVerificationEvidenceDigest({
        runId: run.id,
        verificationStatus: verification.status,
        result: verification,
    });
    await persistBlueprintRunTerminalOrThrow(input.database.db, {
        runId: run.id,
        leaseId,
        leaseOwner: input.leaseOwner,
        now: new Date(),
        status: verification.status === 'matched' ? 'succeeded' : 'needs_reconciliation',
        verificationEvidenceDigest,
        verificationResult: verification,
        verificationStatus: verification.status,
    });
    return 'progressed';
}

async function persistBlueprintRunTerminalOrThrow(
    db: Parameters<typeof finalizeBlueprintRun>[0],
    input: Parameters<typeof finalizeBlueprintRun>[1]
) {
    const result = await finalizeBlueprintRun(db, input);
    if (result.isErr()) throw new Error('blueprint-run-finalize-failed');
    return result.value;
}

async function persistBlueprintRunCheckpointOrThrow(
    db: Parameters<typeof checkpointBlueprintRun>[0],
    input: Parameters<typeof checkpointBlueprintRun>[1]
) {
    const result = await checkpointBlueprintRun(db, input);
    if (result.isErr()) throw new Error('blueprint-run-checkpoint-failed');
    return result.value;
}

async function completeBlueprintRunStepAttemptWithRetry(
    db: Parameters<typeof completeAndCheckpointBlueprintRunStepAttempt>[0],
    input: Parameters<typeof completeAndCheckpointBlueprintRunStepAttempt>[1]
) {
    const first = await completeAndCheckpointBlueprintRunStepAttempt(db, input);
    if (first.isOk()) return first;
    return completeAndCheckpointBlueprintRunStepAttempt(db, input);
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function fallbackRetryAfterMs(targetType: string | undefined): number {
    return targetType === 'role' || targetType === 'role-order' ? 60_000 : 10_000;
}

function readMutationFenceConstructionError(error: unknown): string {
    return error instanceof Error && error.message === 'blueprint-mutation-fence-manifest-too-large'
        ? 'mutation-fence-manifest-too-large'
        : 'pre-mutation-observation-invalid';
}

function runPhaseForStep(
    actionType: string | undefined,
    targetType: string | undefined
): Extract<BlueprintRunPhase, 'preparing' | 'create' | 'update' | 'delete' | 'channel_order' | 'role_order'> {
    if (targetType === 'channel-order') return 'channel_order';
    if (targetType === 'role-order') return 'role_order';
    return actionType === 'create' || actionType === 'update' || actionType === 'delete' ? actionType : 'preparing';
}
