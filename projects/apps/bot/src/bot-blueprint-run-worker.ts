import { createHash, randomUUID } from 'node:crypto';

import {
    createBlueprintSnapshotFingerprintInput,
    deriveBlueprintCursorAuthority,
    normalizeBlueprintPersistedPlanAuthority,
    normalizeBlueprintPlanStep,
    toBlueprintSnapshot,
    toPortableBlueprintSnapshot,
} from '@neonflux/blueprint';
import type { AppLogger } from '@neonflux/core/logging';
import {
    authorizeBlueprintRunMutation,
    checkpointBlueprintRun,
    claimNextBlueprintRun,
    completeAndCheckpointBlueprintRunStepAttempt,
    ensureBlueprintRunRestorePoint,
    finalizeBlueprintRun,
    prepareBlueprintRunStepAttempt,
    renewBlueprintRunLease,
    startBlueprintRunStepAttempt,
    type RuntimeDbClient,
    type BlueprintRunStepAttemptRecord,
    type BlueprintRunPhase,
    type BlueprintRunProtocolMismatchRecord,
} from '@neonflux/db';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { verifyProjectedStructureSnapshot } from './bot-blueprint-run-verification.js';
import {
    readResolvedBlueprintSourceTargetMap,
    readBlueprintTargetKinds,
    toBlueprintApplyAction,
} from './bot-blueprint-provider-steps.js';

const leaseTtlMs = 3 * 60_000;
const workerFailureBackoffMinMs = 2_000;
const workerFailureBackoffMaxMs = 60_000;

type BlueprintRunWorkerResult =
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
    const { run, plan, steps } = claim.value;
    const planAuthority = normalizeBlueprintPersistedPlanAuthority(plan.plan);
    const invalidStep = steps.find((action) => {
        const result = normalizeBlueprintPlanStep({
            actionType: action.actionType,
            targetType: action.targetType,
            ...(action.targetId ? { targetId: action.targetId } : {}),
            label: typeof action.details.label === 'string' ? action.details.label : '',
            details: action.details,
        });
        return result.type === 'invalid';
    });
    if (planAuthority.type === 'invalid' || invalidStep) {
        await finalizeBlueprintRun(input.database.db, {
            errorType:
                planAuthority.type === 'invalid' ? 'invalid-blueprint-plan-authority' : 'invalid-blueprint-plan-step',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            ...(run.restorePointBackupId ? { restorePointBackupId: run.restorePointBackupId } : {}),
            status: run.appliedSteps > 0 ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    const pendingAttempts = new Map<string, BlueprintRunStepAttemptRecord>();
    const attemptCounts = new Map<string, number>();
    for (const attempt of claim.value.attempts) {
        attemptCounts.set(attempt.planStepId, Math.max(attemptCounts.get(attempt.planStepId) ?? 0, attempt.attempt));
        const pending = pendingAttempts.get(attempt.planStepId);
        if (attempt.state === 'pending' && (!pending || attempt.attempt > pending.attempt)) {
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
    let latestIdMap = run.idMap;
    let nextStepSequence = run.nextStepSequence;
    const executableSteps = steps.filter((action) => action.sequence >= run.nextStepSequence);
    const knownTargetKinds = readBlueprintTargetKinds(plan.plan.knownTargetKinds);
    const initialIdMap = readResolvedBlueprintSourceTargetMap(plan.plan.sourceTargetMap);
    const sourceGuildId = typeof plan.plan.requestedGuildId === 'string' ? plan.plan.requestedGuildId : undefined;
    const referenceValidation = deriveBlueprintCursorAuthority({
        actions: steps.map(toBlueprintApplyAction),
        cursor: run.nextStepSequence,
        runIdMap: run.idMap,
        guildId: run.guildId,
        initialIdMap,
        knownTargetKinds,
        ...(sourceGuildId ? { sourceGuildId } : {}),
    });
    if (!referenceValidation.ok) {
        await finalizeBlueprintRun(input.database.db, {
            errorType: `${referenceValidation.errorType}:${referenceValidation.actionId}`,
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            ...(run.restorePointBackupId ? { restorePointBackupId: run.restorePointBackupId } : {}),
            status: run.appliedSteps > 0 ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    let restorePointBackupId = run.restorePointBackupId;
    if (!restorePointBackupId) {
        const restoreSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: run.guildId,
        });
        if (restoreSnapshot.isErr()) {
            await finalizeBlueprintRun(input.database.db, {
                errorType: 'restore-point-read-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const restorePoint = await ensureBlueprintRunRestorePoint(input.database.db, {
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            structure: toPortableBlueprintSnapshot(restoreSnapshot.value),
        });
        if (restorePoint.isErr()) {
            await finalizeBlueprintRun(input.database.db, {
                errorType: 'restore-point-persist-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        restorePointBackupId = restorePoint.value.backupId;
    }
    if (run.nextStepSequence === 0 && run.appliedSteps === 0 && run.completedMutationSteps === 0) {
        const authorizationSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: run.guildId,
        });
        if (authorizationSnapshot.isErr()) {
            await finalizeBlueprintRun(input.database.db, {
                errorType: 'pre-mutation-live-read-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const authorizationStructure = toBlueprintSnapshot(authorizationSnapshot.value);
        const liveFingerprint = createHash('sha256')
            .update(JSON.stringify(createBlueprintSnapshotFingerprintInput(authorizationStructure)))
            .digest('hex');
        const authorization = await authorizeBlueprintRunMutation(input.database.db, {
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            liveFingerprint,
            now: new Date(),
            structure: authorizationStructure,
        });
        if (authorization.isErr()) {
            await finalizeBlueprintRun(input.database.db, {
                errorType: 'pre-mutation-authorization-failed',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
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
                const renewed = await renewBlueprintRunLease(input.database.db, {
                    runId: run.id,
                    leaseExpiresAt: new Date(Date.now() + leaseTtlMs),
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                });
                state.controlStatus = renewed.isOk() && renewed.value ? renewed.value.status : 'outcome_unknown';
                state.controlRequest = renewed.isOk() && renewed.value ? renewed.value.controlRequest : null;
                state.leaseActive = state.controlStatus === 'running';
                if (!state.leaseActive) return false;
                const persistedStep = steps.find((candidate) => candidate.id === action.id);
                if (persistedStep?.sequence !== nextStepSequence) {
                    state.persistenceFailure = 'blueprint-run-step-sequence-invalid';
                    return false;
                }
                currentStepId = action.id;
                const phaseCheckpoint = await checkpointBlueprintRun(input.database.db, {
                    appliedSteps,
                    completedMutationSteps,
                    currentStepDomain: persistedStep.targetType,
                    currentStepId: action.id,
                    ...(typeof persistedStep.details.label === 'string'
                        ? { currentStepLabel: persistedStep.details.label }
                        : {}),
                    runId: run.id,
                    failedSteps,
                    idMap: latestIdMap,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    nextStepSequence,
                    notStartedSteps: Math.max(0, steps.length - nextStepSequence),
                    now: new Date(),
                    phase: runPhaseForStep(action.actionType, action.targetType),
                    skippedSteps: 0,
                    status: 'running',
                    totalMutationSteps: run.totalMutationSteps,
                });
                if (phaseCheckpoint.isErr()) {
                    state.persistenceFailure = 'step-phase-checkpoint-failed';
                    return false;
                }

                const pending = pendingAttempts.get(action.id);
                if (pending) {
                    activeAttempt = pending;
                    activeAttemptStepId = action.id;
                    activeAttemptStarted = false;
                    pendingAttempts.delete(action.id);
                    return true;
                }

                const attempt = (attemptCounts.get(action.id) ?? 0) + 1;
                const prepared = await prepareBlueprintRunStepAttempt(input.database.db, {
                    planStepId: action.id,
                    attempt,
                    runId: run.id,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                    requestKey: `${run.id}:${action.id}:${String(attempt)}`,
                });
                if (prepared.isErr()) {
                    state.persistenceFailure = 'attempt-prepare-failed';
                    return false;
                }
                attemptCounts.set(action.id, attempt);
                activeAttempt = prepared.value;
                activeAttemptStepId = action.id;
                activeAttemptStarted = false;
                return true;
            },
            beforeMutation: async () => {
                const renewed = await renewBlueprintRunLease(input.database.db, {
                    runId: run.id,
                    leaseExpiresAt: new Date(Date.now() + leaseTtlMs),
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                });
                state.controlStatus = renewed.isOk() && renewed.value ? renewed.value.status : 'outcome_unknown';
                state.controlRequest = renewed.isOk() && renewed.value ? renewed.value.controlRequest : null;
                state.leaseActive = state.controlStatus === 'running';
                if (!state.leaseActive || !currentStepId || !activeAttempt || activeAttemptStepId !== currentStepId) {
                    return false;
                }
                if (!activeAttemptStarted) {
                    const started = await startBlueprintRunStepAttempt(input.database.db, {
                        attemptId: activeAttempt.id,
                        leaseId,
                        leaseOwner: input.leaseOwner,
                        now: new Date(),
                    });
                    if (started.isErr()) {
                        state.persistenceFailure = 'attempt-start-failed';
                        return false;
                    }
                    activeAttempt = started.value;
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
                    idMap: latestIdMap,
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
                const persisted = await completeAndCheckpointBlueprintRunStepAttempt(input.database.db, {
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
            const persisted = await completeAndCheckpointBlueprintRunStepAttempt(input.database.db, {
                appliedSteps,
                attemptId: attempt.id,
                completedMutationSteps,
                currentStepDomain: action.targetType,
                currentStepId: action.id,
                ...(typeof action.details.label === 'string' ? { currentStepLabel: action.details.label } : {}),
                errorType: providerOutcomeUnknown ? 'mutation-callback-outcome-unknown' : 'mutation-callback-failed',
                failedSteps: caughtFailedSteps,
                idMap: latestIdMap,
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
            await finalizeBlueprintRun(input.database.db, {
                errorType: 'mutation-callback-outcome-unknown',
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
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
        await finalizeBlueprintRun(input.database.db, {
            errorType: 'mutation-result-persistence-failed',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            restorePointBackupId,
            status: 'outcome_unknown',
        });
        return 'progressed';
    }
    const terminalErrorType = state.persistenceFailure;
    if (terminalErrorType) {
        await finalizeBlueprintRun(input.database.db, {
            errorType: terminalErrorType,
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
        });
        return 'progressed';
    }
    if (state.controlStatus === 'pause_requested') {
        if (state.controlRequest === 'cancel') {
            await finalizeBlueprintRun(input.database.db, {
                runId: run.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
                status: 'cancelled',
            });
            return 'progressed';
        }
        await checkpointBlueprintRun(input.database.db, {
            appliedSteps,
            completedMutationSteps,
            runId: run.id,
            failedSteps,
            idMap: latestIdMap,
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
        await finalizeBlueprintRun(input.database.db, {
            errorType: result.isErr() ? result.error.type : 'run-control-requested',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
        });
        return 'progressed';
    }
    latestIdMap = result.value.idMap;
    const unhandledFailure = result.value.actions.find((action) => action.status === 'failed');
    if (unhandledFailure || nextStepSequence !== steps.length || failedSteps > 0) {
        await finalizeBlueprintRun(input.database.db, {
            errorType: unhandledFailure?.errorType ?? 'blueprint-run-incomplete',
            runId: run.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
        });
        return 'progressed';
    }
    const verificationCheckpoint = await checkpointBlueprintRun(input.database.db, {
        appliedSteps,
        completedMutationSteps,
        runId: run.id,
        failedSteps,
        idMap: latestIdMap,
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
    const verification = await verifyProjectedStructureSnapshot(input.botToken, run.guildId, plan.plan, latestIdMap);
    await finalizeBlueprintRun(input.database.db, {
        runId: run.id,
        leaseId,
        leaseOwner: input.leaseOwner,
        now: new Date(),
        restorePointBackupId,
        status: verification.status === 'matched' ? 'succeeded' : 'needs_reconciliation',
        verificationResult: verification,
        verificationStatus: verification.status,
    });
    return 'progressed';
}

export function startBlueprintRunWorker(input: {
    botToken: string;
    database: RuntimeDbClient;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `blueprint-run-worker:${randomUUID()}`;
    let running: Promise<void> | undefined;
    let reportedProtocolMismatchKey: string | undefined;
    let disabled = false;
    let failureCount = 0;
    let nextAttemptAt = 0;
    const tick = () => {
        if (disabled || running || Date.now() < nextAttemptAt) return;
        running = runNextBlueprintRun({ ...input, leaseOwner })
            .then((result) => {
                failureCount = 0;
                nextAttemptAt = 0;
                if (typeof result === 'string') {
                    reportedProtocolMismatchKey = undefined;
                    return;
                }
                if (result.kind === 'backend_incompatible') {
                    disabled = true;
                    clearInterval(interval);
                    input.logger.error('blueprint_run.backend_incompatible', {
                        action: 'worker_disabled',
                    });
                    return;
                }
                const mismatchKey = `${result.runId}:${String(result.runProtocolVersion)}:${String(result.requiredProtocolVersion)}`;
                if (mismatchKey === reportedProtocolMismatchKey) return;
                reportedProtocolMismatchKey = mismatchKey;
                input.logger.error('blueprint_run.protocol_mismatch', {
                    runId: result.runId,
                    runProtocolVersion: result.runProtocolVersion,
                    guildId: result.guildId,
                    mayHaveExternalEffects: result.mayHaveExternalEffects,
                    requiredProtocolVersion: result.requiredProtocolVersion,
                    status: result.status,
                });
            })
            .catch((error: unknown) => {
                failureCount += 1;
                const retryAfterMs = Math.min(
                    workerFailureBackoffMaxMs,
                    workerFailureBackoffMinMs * 2 ** Math.min(failureCount - 1, 20)
                );
                nextAttemptAt = Date.now() + retryAfterMs;
                input.logger.error('blueprint_run.worker_failed', {
                    error: error instanceof Error ? error.message : String(error),
                    retryAfterMs,
                });
            })
            .finally(() => {
                running = undefined;
            });
    };
    const interval = setInterval(tick, input.intervalMs ?? 2_000);
    tick();
    return {
        async stop() {
            clearInterval(interval);
            await running;
        },
    };
}

function fallbackRetryAfterMs(targetType: string | undefined): number {
    return targetType === 'role' || targetType === 'role-order' ? 60_000 : 10_000;
}

function runPhaseForStep(
    actionType: string | undefined,
    targetType: string | undefined
): Extract<BlueprintRunPhase, 'preparing' | 'create' | 'update' | 'delete' | 'channel_order' | 'role_order'> {
    if (targetType === 'channel-order') return 'channel_order';
    if (targetType === 'role-order') return 'role_order';
    return actionType === 'create' || actionType === 'update' || actionType === 'delete' ? actionType : 'preparing';
}
