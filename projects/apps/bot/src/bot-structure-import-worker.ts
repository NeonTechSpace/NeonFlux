import { createHash, randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';
import {
    authorizeStructureImportExecutionMutation,
    checkpointStructureImportExecution,
    claimNextStructureImportExecution,
    completeAndCheckpointStructureImportActionAttempt,
    ensureStructureImportRestorePoint,
    finalizeStructureImportExecution,
    prepareStructureImportActionAttempt,
    renewStructureImportExecutionLease,
    startStructureImportActionAttempt,
    type RuntimeDbClient,
    type StructureImportActionAttemptRecord,
    type StructureImportExecutionPhase,
    type StructureImportExecutionProtocolMismatchRecord,
} from '@neonflux/db';
import {
    applyFluxerBotGuildStructureActions,
    createFluxerGuildStructureSnapshotFingerprintInput,
    deriveFluxerBotGuildStructureCursorAuthority,
    readFluxerBotGuildStructure,
    toFluxerGuildStructureSnapshot,
} from '@neonflux/fluxer';

import { verifyProjectedStructureSnapshot } from './bot-structure-import-verification.js';
import {
    readResolvedStructureSourceTargetMap,
    readStructureTargetKinds,
    toStructureApplyAction,
} from './bot-structure-import-actions.js';

const leaseTtlMs = 3 * 60_000;
const workerFailureBackoffMinMs = 2_000;
const workerFailureBackoffMaxMs = 60_000;

type StructureImportWorkerRunResult =
    | 'idle'
    | 'progressed'
    | { kind: 'backend_incompatible' }
    | StructureImportExecutionProtocolMismatchRecord;

export async function runNextStructureImportExecution(input: {
    botToken: string;
    database: RuntimeDbClient;
    leaseOwner: string;
    now?: Date;
}): Promise<StructureImportWorkerRunResult> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextStructureImportExecution(input.database.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) {
        if (claim.error.type === 'backend-incompatible') return { kind: 'backend_incompatible' };
        throw new Error('structure-import-execution-claim-failed');
    }
    if (!claim.value) return 'idle';
    if (claim.value.kind === 'protocol_mismatch') return claim.value;
    const { execution, run, actions } = claim.value;
    const pendingAttempts = new Map<string, StructureImportActionAttemptRecord>();
    const attemptCounts = new Map<string, number>();
    for (const attempt of claim.value.attempts) {
        attemptCounts.set(attempt.actionId, Math.max(attemptCounts.get(attempt.actionId) ?? 0, attempt.attempt));
        const pending = pendingAttempts.get(attempt.actionId);
        if (attempt.state === 'pending' && (!pending || attempt.attempt > pending.attempt)) {
            pendingAttempts.set(attempt.actionId, attempt);
        }
    }
    let activeAttempt: StructureImportActionAttemptRecord | undefined;
    let activeAttemptActionId: string | undefined;
    let activeAttemptStarted = false;
    let currentActionId: string | undefined;
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
        knownPartialMutation: execution.appliedActions > 0,
        leaseActive: true,
        outcomeUnknown: false,
        terminalPersisted: false,
    };
    let appliedActions = execution.appliedActions;
    let failedActions = execution.failedActions;
    let completedMutationSteps = execution.completedMutationSteps;
    let latestIdMap = execution.idMap;
    let nextActionSequence = execution.nextActionSequence;
    const executableActions = actions.filter((action) => action.sequence >= execution.nextActionSequence);
    const knownTargetKinds = readStructureTargetKinds(run.plan.knownTargetKinds);
    const initialIdMap = readResolvedStructureSourceTargetMap(run.plan.sourceTargetMap);
    const sourceGuildId = typeof run.plan.requestedGuildId === 'string' ? run.plan.requestedGuildId : undefined;
    const referenceValidation = deriveFluxerBotGuildStructureCursorAuthority({
        actions: actions.map(toStructureApplyAction),
        cursor: execution.nextActionSequence,
        executionIdMap: execution.idMap,
        guildId: execution.guildId,
        initialIdMap,
        knownTargetKinds,
        ...(sourceGuildId ? { sourceGuildId } : {}),
    });
    if (!referenceValidation.ok) {
        await finalizeStructureImportExecution(input.database.db, {
            errorType: `${referenceValidation.errorType}:${referenceValidation.actionId}`,
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            ...(execution.restorePointBackupId ? { restorePointBackupId: execution.restorePointBackupId } : {}),
            status: execution.appliedActions > 0 ? 'partially_applied' : 'failed_before_mutation',
        });
        return 'progressed';
    }
    let restorePointBackupId = execution.restorePointBackupId;
    if (!restorePointBackupId) {
        const restoreSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: execution.guildId,
        });
        if (restoreSnapshot.isErr()) {
            await finalizeStructureImportExecution(input.database.db, {
                errorType: 'restore-point-read-failed',
                executionId: execution.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const restorePoint = await ensureStructureImportRestorePoint(input.database.db, {
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            structure: toFluxerGuildStructureSnapshot(restoreSnapshot.value),
        });
        if (restorePoint.isErr()) {
            await finalizeStructureImportExecution(input.database.db, {
                errorType: 'restore-point-persist-failed',
                executionId: execution.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        restorePointBackupId = restorePoint.value.backupId;
    }
    if (
        execution.nextActionSequence === 0 &&
        execution.appliedActions === 0 &&
        execution.completedMutationSteps === 0
    ) {
        const authorizationSnapshot = await readFluxerBotGuildStructure({
            botToken: input.botToken,
            guildId: execution.guildId,
        });
        if (authorizationSnapshot.isErr()) {
            await finalizeStructureImportExecution(input.database.db, {
                errorType: 'pre-mutation-live-read-failed',
                executionId: execution.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
                status: 'failed_before_mutation',
            });
            return 'progressed';
        }
        const authorizationStructure = toFluxerGuildStructureSnapshot(authorizationSnapshot.value);
        const liveFingerprint = createHash('sha256')
            .update(JSON.stringify(createFluxerGuildStructureSnapshotFingerprintInput(authorizationStructure)))
            .digest('hex');
        const authorization = await authorizeStructureImportExecutionMutation(input.database.db, {
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            liveFingerprint,
            now: new Date(),
            structure: authorizationStructure,
        });
        if (authorization.isErr()) {
            await finalizeStructureImportExecution(input.database.db, {
                errorType: 'pre-mutation-authorization-failed',
                executionId: execution.id,
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
            guildId: execution.guildId,
            actions: executableActions.map(toStructureApplyAction),
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
                const renewed = await renewStructureImportExecutionLease(input.database.db, {
                    executionId: execution.id,
                    leaseExpiresAt: new Date(Date.now() + leaseTtlMs),
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                });
                state.controlStatus = renewed.isOk() && renewed.value ? renewed.value.status : 'outcome_unknown';
                state.controlRequest = renewed.isOk() && renewed.value ? renewed.value.controlRequest : null;
                state.leaseActive = state.controlStatus === 'running';
                if (!state.leaseActive) return false;
                const persistedAction = actions.find((candidate) => candidate.id === action.id);
                if (persistedAction?.sequence !== nextActionSequence) {
                    state.persistenceFailure = 'structure-execution-action-sequence-invalid';
                    return false;
                }
                currentActionId = action.id;
                const phaseCheckpoint = await checkpointStructureImportExecution(input.database.db, {
                    appliedActions,
                    completedMutationSteps,
                    currentActionDomain: persistedAction.targetType,
                    currentActionId: action.id,
                    ...(typeof persistedAction.details.label === 'string'
                        ? { currentActionLabel: persistedAction.details.label }
                        : {}),
                    executionId: execution.id,
                    failedActions,
                    idMap: latestIdMap,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    nextActionSequence,
                    notStartedActions: Math.max(0, actions.length - nextActionSequence),
                    now: new Date(),
                    phase: executionPhaseForAction(action.actionType, action.targetType),
                    skippedActions: 0,
                    status: 'running',
                    totalMutationSteps: execution.totalMutationSteps,
                });
                if (phaseCheckpoint.isErr()) {
                    state.persistenceFailure = 'action-phase-checkpoint-failed';
                    return false;
                }

                const pending = pendingAttempts.get(action.id);
                if (pending) {
                    activeAttempt = pending;
                    activeAttemptActionId = action.id;
                    activeAttemptStarted = false;
                    pendingAttempts.delete(action.id);
                    return true;
                }

                const attempt = (attemptCounts.get(action.id) ?? 0) + 1;
                const prepared = await prepareStructureImportActionAttempt(input.database.db, {
                    actionId: action.id,
                    attempt,
                    executionId: execution.id,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                    requestKey: `${execution.id}:${action.id}:${String(attempt)}`,
                });
                if (prepared.isErr()) {
                    state.persistenceFailure = 'attempt-prepare-failed';
                    return false;
                }
                attemptCounts.set(action.id, attempt);
                activeAttempt = prepared.value;
                activeAttemptActionId = action.id;
                activeAttemptStarted = false;
                return true;
            },
            beforeMutation: async () => {
                const renewed = await renewStructureImportExecutionLease(input.database.db, {
                    executionId: execution.id,
                    leaseExpiresAt: new Date(Date.now() + leaseTtlMs),
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    now: new Date(),
                });
                state.controlStatus = renewed.isOk() && renewed.value ? renewed.value.status : 'outcome_unknown';
                state.controlRequest = renewed.isOk() && renewed.value ? renewed.value.controlRequest : null;
                state.leaseActive = state.controlStatus === 'running';
                if (
                    !state.leaseActive ||
                    !currentActionId ||
                    !activeAttempt ||
                    activeAttemptActionId !== currentActionId
                ) {
                    return false;
                }
                if (!activeAttemptStarted) {
                    const started = await startStructureImportActionAttempt(input.database.db, {
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
                const action = actions.find((candidate) => candidate.id === actionResult.id);
                const attempt = activeAttempt;
                const attemptStarted = activeAttemptStarted;
                const isRateLimited = actionResult.errorType === 'rate-limited';
                const isLeaseLost = actionResult.errorType === 'apply-lease-lost';
                const isOutcomeUnknown = actionResult.status === 'failed' && actionResult.mutationOutcome === 'unknown';
                const isHardFailure =
                    actionResult.status === 'failed' && !isRateLimited && !isLeaseLost && !isOutcomeUnknown;

                if (action?.sequence !== nextActionSequence) {
                    if (attemptStarted) state.outcomeUnknown = true;
                    else state.persistenceFailure = 'action-result-sequence-invalid';
                    return false;
                }
                if (actionResult.status === 'applied') {
                    if (!attemptStarted) {
                        state.persistenceFailure = 'action-applied-without-started-attempt';
                        return false;
                    }
                    appliedActions += 1;
                    completedMutationSteps += 1;
                    nextActionSequence = action.sequence + 1;
                } else if (isHardFailure) {
                    failedActions += 1;
                    nextActionSequence = action.sequence + 1;
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
                    activeAttemptActionId = undefined;
                    activeAttemptStarted = false;
                    return false;
                }
                const errorType = isOutcomeUnknown
                    ? `mutation-outcome-unknown:${actionResult.errorType ?? 'operation-failed'}`
                    : actionResult.errorType;
                const requestedStatus = isOutcomeUnknown
                    ? ('outcome_unknown' as const)
                    : isHardFailure
                      ? appliedActions > 0
                          ? ('partially_applied' as const)
                          : ('failed_before_mutation' as const)
                      : isRateLimited
                        ? ('waiting_rate_limit' as const)
                        : state.controlStatus === 'pause_requested'
                          ? ('pause_requested' as const)
                          : ('running' as const);
                const progress = {
                    appliedActions,
                    completedMutationSteps,
                    currentActionDomain: action.targetType,
                    currentActionId: action.id,
                    ...(typeof action.details.label === 'string' ? { currentActionLabel: action.details.label } : {}),
                    failedActions,
                    idMap: latestIdMap,
                    leaseId,
                    leaseOwner: input.leaseOwner,
                    nextActionSequence,
                    notStartedActions: Math.max(0, actions.length - nextActionSequence),
                    now: new Date(),
                    phase:
                        requestedStatus === 'waiting_rate_limit'
                            ? ('waiting_rate_limit' as const)
                            : requestedStatus === 'partially_applied' ||
                                requestedStatus === 'failed_before_mutation' ||
                                requestedStatus === 'outcome_unknown'
                              ? ('complete' as const)
                              : executionPhaseForAction(action.actionType, action.targetType),
                    skippedActions: 0,
                    status: requestedStatus,
                    totalMutationSteps: execution.totalMutationSteps,
                };
                const persisted = await completeAndCheckpointStructureImportActionAttempt(input.database.db, {
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
                        state.persistenceFailure = 'local-action-result-persistence-failed';
                    }
                } else {
                    state.controlStatus = persisted.value.execution.status;
                    state.controlRequest = persisted.value.execution.controlRequest;
                    state.leaseActive = persisted.value.execution.status === 'running';
                    state.terminalPersisted = [
                        'partially_applied',
                        'failed_before_mutation',
                        'outcome_unknown',
                        'cancelled',
                    ].includes(persisted.value.execution.status);
                }
                activeAttempt = undefined;
                activeAttemptActionId = undefined;
                activeAttemptStarted = false;
                return (
                    persisted.isOk() &&
                    actionResult.status === 'applied' &&
                    persisted.value.execution.status === 'running'
                );
            },
        });
    } catch {
        const attempt = activeAttempt;
        const action = currentActionId ? actions.find((candidate) => candidate.id === currentActionId) : undefined;
        if (attempt && action?.sequence === nextActionSequence) {
            const providerOutcomeUnknown = attempt.state === 'started';
            const caughtFailedActions = providerOutcomeUnknown ? failedActions : failedActions + 1;
            const caughtNextActionSequence = providerOutcomeUnknown ? nextActionSequence : action.sequence + 1;
            const persisted = await completeAndCheckpointStructureImportActionAttempt(input.database.db, {
                appliedActions,
                attemptId: attempt.id,
                completedMutationSteps,
                currentActionDomain: action.targetType,
                currentActionId: action.id,
                ...(typeof action.details.label === 'string' ? { currentActionLabel: action.details.label } : {}),
                errorType: providerOutcomeUnknown ? 'mutation-callback-outcome-unknown' : 'mutation-callback-failed',
                failedActions: caughtFailedActions,
                idMap: latestIdMap,
                leaseId,
                leaseOwner: input.leaseOwner,
                nextActionSequence: caughtNextActionSequence,
                notStartedActions: Math.max(0, actions.length - caughtNextActionSequence),
                now: new Date(),
                phase: 'complete',
                skippedActions: 0,
                state: providerOutcomeUnknown ? 'unknown' : 'failed',
                status: providerOutcomeUnknown
                    ? 'outcome_unknown'
                    : appliedActions > 0
                      ? 'partially_applied'
                      : 'failed_before_mutation',
                totalMutationSteps: execution.totalMutationSteps,
            });
            if (persisted.isOk()) return 'progressed';
        }
        if (activeAttempt?.state === 'started') {
            await finalizeStructureImportExecution(input.database.db, {
                errorType: 'mutation-callback-outcome-unknown',
                executionId: execution.id,
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
        await finalizeStructureImportExecution(input.database.db, {
            errorType: 'mutation-result-persistence-failed',
            executionId: execution.id,
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
        await finalizeStructureImportExecution(input.database.db, {
            errorType: terminalErrorType,
            executionId: execution.id,
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
            await finalizeStructureImportExecution(input.database.db, {
                executionId: execution.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                restorePointBackupId,
                status: 'cancelled',
            });
            return 'progressed';
        }
        await checkpointStructureImportExecution(input.database.db, {
            appliedActions,
            completedMutationSteps,
            executionId: execution.id,
            failedActions,
            idMap: latestIdMap,
            leaseId,
            leaseOwner: input.leaseOwner,
            nextActionSequence,
            notStartedActions: Math.max(0, actions.length - nextActionSequence),
            now: new Date(),
            phase: 'paused',
            skippedActions: 0,
            status: 'paused',
            totalMutationSteps: execution.totalMutationSteps,
        });
        return 'progressed';
    }
    if (state.rateLimited) return 'progressed';
    if (result.isErr() || !state.leaseActive) {
        await finalizeStructureImportExecution(input.database.db, {
            errorType: result.isErr() ? result.error.type : 'execution-control-requested',
            executionId: execution.id,
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
    if (unhandledFailure || nextActionSequence !== actions.length || failedActions > 0) {
        await finalizeStructureImportExecution(input.database.db, {
            errorType: unhandledFailure?.errorType ?? 'structure-execution-incomplete',
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: state.knownPartialMutation ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
        });
        return 'progressed';
    }
    const verificationCheckpoint = await checkpointStructureImportExecution(input.database.db, {
        appliedActions,
        completedMutationSteps,
        executionId: execution.id,
        failedActions,
        idMap: latestIdMap,
        leaseId,
        leaseOwner: input.leaseOwner,
        nextActionSequence,
        notStartedActions: 0,
        now: new Date(),
        phase: 'verifying',
        skippedActions: 0,
        status: 'verifying',
        totalMutationSteps: execution.totalMutationSteps,
    });
    if (verificationCheckpoint.isErr()) return 'progressed';
    const verification = await verifyProjectedStructureSnapshot(
        input.botToken,
        execution.guildId,
        run.plan,
        latestIdMap
    );
    await finalizeStructureImportExecution(input.database.db, {
        executionId: execution.id,
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

export function startStructureImportExecutionWorker(input: {
    botToken: string;
    database: RuntimeDbClient;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `structure-import-worker:${randomUUID()}`;
    let running: Promise<void> | undefined;
    let reportedProtocolMismatchKey: string | undefined;
    let disabled = false;
    let failureCount = 0;
    let nextAttemptAt = 0;
    const run = () => {
        if (disabled || running || Date.now() < nextAttemptAt) return;
        running = runNextStructureImportExecution({ ...input, leaseOwner })
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
                    input.logger.error('structure_import.backend_incompatible', {
                        action: 'worker_disabled',
                    });
                    return;
                }
                const mismatchKey = `${result.executionId}:${String(result.executionProtocolVersion)}:${String(result.requiredProtocolVersion)}`;
                if (mismatchKey === reportedProtocolMismatchKey) return;
                reportedProtocolMismatchKey = mismatchKey;
                input.logger.error('structure_import.execution_protocol_mismatch', {
                    executionId: result.executionId,
                    executionProtocolVersion: result.executionProtocolVersion,
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
                input.logger.error('structure_import.worker_failed', {
                    error: error instanceof Error ? error.message : String(error),
                    retryAfterMs,
                });
            })
            .finally(() => {
                running = undefined;
            });
    };
    const interval = setInterval(run, input.intervalMs ?? 2_000);
    run();
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

function executionPhaseForAction(
    actionType: string | undefined,
    targetType: string | undefined
): Extract<
    StructureImportExecutionPhase,
    'preparing' | 'create' | 'update' | 'delete' | 'channel_order' | 'role_order'
> {
    if (targetType === 'channel-order') return 'channel_order';
    if (targetType === 'role-order') return 'role_order';
    return actionType === 'create' || actionType === 'update' || actionType === 'delete' ? actionType : 'preparing';
}
