import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';
import {
    checkpointStructureImportExecution,
    claimNextStructureImportExecution,
    completeAndCheckpointStructureImportActionAttempt,
    ensureStructureImportRestorePoint,
    finalizeStructureImportExecution,
    renewStructureImportExecutionLease,
    startStructureImportActionAttempt,
    type RuntimeDbClient,
    type StructureImportActionAttemptRecord,
    type StructureImportExecutionPhase,
} from '@neonflux/db';
import {
    applyFluxerBotGuildStructureActions,
    normalizeFluxerGuildStructureSnapshot,
    readFluxerBotGuildStructure,
    toFluxerGuildStructureSnapshot,
} from '@neonflux/fluxer';

const leaseTtlMs = 3 * 60_000;

export async function runNextStructureImportExecution(input: {
    botToken: string;
    database: RuntimeDbClient;
    leaseOwner: string;
    now?: Date;
}): Promise<'idle' | 'progressed'> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextStructureImportExecution(input.database.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr() || !claim.value) return 'idle';
    const { execution, run, actions } = claim.value;
    const attempts = new Map<string, StructureImportActionAttemptRecord>();
    const attemptCounts = new Map<string, number>();
    for (const attempt of claim.value.attempts) {
        attemptCounts.set(attempt.actionId, Math.max(attemptCounts.get(attempt.actionId) ?? 0, attempt.attempt));
    }
    let activeAttempt: StructureImportActionAttemptRecord | undefined;
    let activeAttemptActionId: string | undefined;
    let activeAttemptMutationSteps = 0;
    let currentActionId: string | undefined;
    const state: {
        controlRequest: 'pause' | 'cancel' | null;
        controlStatus: string;
        leaseActive: boolean;
        outcomeUnknown: boolean;
        rateLimited?: { retryAfterMs: number };
        retryExhausted: boolean;
    } = {
        controlRequest: null,
        controlStatus: 'running',
        leaseActive: true,
        outcomeUnknown: false,
        retryExhausted: false,
    };
    let appliedActions = execution.appliedActions;
    let failedActions = execution.failedActions;
    let completedMutationSteps = execution.completedMutationSteps;
    let latestIdMap = execution.idMap;
    let nextActionSequence = execution.nextActionSequence;
    const executableActions = actions.filter(
        (action) =>
            action.sequence >= execution.nextActionSequence &&
            action.targetType !== 'channel-order' &&
            action.targetType !== 'role-order'
    );
    const channelOrder = readOrder(actions, 'channel-order');
    const roleOrder = readOrder(actions, 'role-order');
    const channelOrderActionId = actions.find((action) => action.targetType === 'channel-order')?.id;
    const roleOrderActionId = actions.find((action) => action.targetType === 'role-order')?.id;
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
    const result = await applyFluxerBotGuildStructureActions({
        botToken: input.botToken,
        guildId: execution.guildId,
        actions: executableActions.map((action) => {
            const changes = readChanges(action.details.changes);
            return {
                id: action.id,
                actionType: action.actionType,
                targetType: action.targetType,
                targetId: action.targetId ?? '',
                after: action.details.after,
                ...(changes ? { changes } : {}),
            };
        }),
        idMap: execution.idMap,
        ...(channelOrder ? { channelOrder } : {}),
        ...(channelOrder && channelOrderActionId ? { channelOrderActionId } : {}),
        ...(roleOrder ? { roleOrder } : {}),
        ...(roleOrder && roleOrderActionId ? { roleOrderActionId } : {}),
        beforeAction: async (action) => {
            if (activeAttempt) {
                state.outcomeUnknown = true;
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
            currentActionId = action.id;
            const persistedAction = actions.find((candidate) => candidate.id === action.id);
            const phaseCheckpoint = await checkpointStructureImportExecution(input.database.db, {
                appliedActions,
                completedMutationSteps,
                currentActionDomain: persistedAction?.targetType ?? action.targetType,
                currentActionId: action.id,
                ...(typeof persistedAction?.details.label === 'string'
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
            return phaseCheckpoint.isOk();
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
            if (!state.leaseActive || !currentActionId) return false;
            if (activeAttempt) {
                if (activeAttemptActionId !== currentActionId) return false;
                activeAttemptMutationSteps += 1;
                return true;
            }
            const attempt = (attemptCounts.get(currentActionId) ?? 0) + 1;
            if (attempt > 5) {
                state.retryExhausted = true;
                return false;
            }
            attemptCounts.set(currentActionId, attempt);
            const started = await startStructureImportActionAttempt(input.database.db, {
                actionId: currentActionId,
                attempt,
                executionId: execution.id,
                leaseId,
                leaseOwner: input.leaseOwner,
                now: new Date(),
                requestKey: `${execution.id}:${currentActionId}:${String(attempt)}`,
            });
            if (started.isErr()) return false;
            activeAttempt = started.value;
            activeAttemptActionId = currentActionId;
            activeAttemptMutationSteps = 1;
            attempts.set(currentActionId, started.value);
            return state.leaseActive;
        },
        onActionResult: async (actionResult, idMap) => {
            const attempt = activeAttempt ?? attempts.get(actionResult.id);
            if (attempt) completedMutationSteps += activeAttemptMutationSteps;
            activeAttempt = undefined;
            activeAttemptActionId = undefined;
            activeAttemptMutationSteps = 0;
            attempts.delete(actionResult.id);
            if (actionResult.status === 'applied') appliedActions += 1;
            else if (actionResult.errorType !== 'rate-limited' && actionResult.errorType !== 'apply-lease-lost') {
                if (actionResult.createdId) appliedActions += 1;
                failedActions += 1;
            }
            latestIdMap = { ...idMap };
            const action = actions.find((candidate) => candidate.id === actionResult.id);
            const isRateLimited = actionResult.errorType === 'rate-limited';
            const isLeaseLost = actionResult.errorType === 'apply-lease-lost';
            nextActionSequence =
                isRateLimited || isLeaseLost
                    ? Math.min(nextActionSequence, action?.sequence ?? nextActionSequence)
                    : (action?.sequence ?? nextActionSequence) + 1;
            if (isRateLimited)
                state.rateLimited = {
                    retryAfterMs: actionResult.retryAfterMs ?? fallbackRetryAfterMs(action?.targetType),
                };
            if (isLeaseLost) state.leaseActive = false;
            const progress = {
                appliedActions,
                completedMutationSteps,
                ...(action ? { currentActionDomain: action.targetType, currentActionId: action.id } : {}),
                ...(typeof action?.details.label === 'string' ? { currentActionLabel: action.details.label } : {}),
                failedActions,
                idMap: latestIdMap,
                leaseId,
                leaseOwner: input.leaseOwner,
                nextActionSequence,
                notStartedActions: Math.max(0, actions.length - nextActionSequence),
                now: new Date(),
                phase: executionPhaseForAction(action?.actionType, action?.targetType),
                skippedActions: 0,
                status: state.controlStatus === 'pause_requested' ? ('pause_requested' as const) : ('running' as const),
                totalMutationSteps: execution.totalMutationSteps,
            };
            const persisted = attempt
                ? await completeAndCheckpointStructureImportActionAttempt(input.database.db, {
                      ...progress,
                      attemptId: attempt.id,
                      ...(actionResult.createdId ? { createdId: actionResult.createdId } : {}),
                      ...(actionResult.errorType ? { errorType: actionResult.errorType } : {}),
                      ...(isRateLimited && state.rateLimited
                          ? { retryAt: new Date(Date.now() + state.rateLimited.retryAfterMs) }
                          : {}),
                      state: actionResult.status === 'applied' ? 'applied' : 'failed',
                  })
                : await checkpointStructureImportExecution(input.database.db, {
                      ...progress,
                      executionId: execution.id,
                  });
            if (persisted.isErr() && attempt) state.outcomeUnknown = true;
            return persisted.isOk() && !isRateLimited && !isLeaseLost;
        },
        stopAfterDeleteFailures: run.policy === 'rebuild',
    });
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
    if (state.controlStatus === 'cancelled') return 'progressed';
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
    if (state.rateLimited) {
        await checkpointStructureImportExecution(input.database.db, {
            appliedActions,
            completedMutationSteps,
            errorType: 'rate-limited',
            executionId: execution.id,
            failedActions,
            idMap: latestIdMap,
            leaseId,
            leaseOwner: input.leaseOwner,
            nextActionSequence,
            notStartedActions: Math.max(0, actions.length - nextActionSequence),
            now: new Date(),
            phase: 'waiting_rate_limit',
            retryAt: new Date(Date.now() + state.rateLimited.retryAfterMs),
            skippedActions: 0,
            status: 'waiting_rate_limit',
            totalMutationSteps: execution.totalMutationSteps,
        });
        return 'progressed';
    }
    if (result.isErr() || !state.leaseActive || state.retryExhausted) {
        await finalizeStructureImportExecution(input.database.db, {
            errorType: result.isErr() ? result.error.type : 'execution-control-requested',
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: appliedActions > 0 ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
        });
        return 'progressed';
    }
    latestIdMap = result.value.idMap;
    if (result.value.actions.some((action) => action.status === 'failed')) {
        await finalizeStructureImportExecution(input.database.db, {
            executionId: execution.id,
            leaseId,
            leaseOwner: input.leaseOwner,
            now: new Date(),
            status: appliedActions > 0 ? 'partially_applied' : 'failed_before_mutation',
            restorePointBackupId,
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
        nextActionSequence: actions.length,
        notStartedActions: 0,
        now: new Date(),
        phase: 'verifying',
        skippedActions: 0,
        status: 'verifying',
        totalMutationSteps: execution.totalMutationSteps,
    });
    const verification = await verifyProjectedSnapshot(input.botToken, execution.guildId, run.plan, latestIdMap);
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
    const run = () => {
        if (running) return;
        running = runNextStructureImportExecution({ ...input, leaseOwner })
            .then(() => undefined)
            .catch((error: unknown) => {
                input.logger.error('structure_import.worker_failed', {
                    error: error instanceof Error ? error.message : String(error),
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

function readChanges(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((change) =>
        isObject(change) && typeof change.field === 'string'
            ? [
                  {
                      field: change.field,
                      ...(change.before !== undefined ? { before: change.before } : {}),
                      after: change.after,
                  },
              ]
            : []
    );
}

function readOrder(actions: Array<{ targetType: string; details: Record<string, unknown> }>, targetType: string) {
    const value = actions.find((action) => action.targetType === targetType)?.details.after;
    return Array.isArray(value) ? (value as never[]) : undefined;
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

async function verifyProjectedSnapshot(
    botToken: string,
    guildId: string,
    plan: Record<string, unknown>,
    idMap: Record<string, string>
): Promise<{
    status: 'matched' | 'mismatch' | 'read_failed';
    expectedFingerprint?: string;
    actualFingerprint?: string;
}> {
    const projected = normalizeFluxerGuildStructureSnapshot(plan.projectedSnapshot);
    if (projected.type !== 'valid') return { status: 'mismatch' };
    const current = await readFluxerBotGuildStructure({ botToken, guildId });
    if (current.isErr()) return { status: 'read_failed' };
    const actual = toFluxerGuildStructureSnapshot(current.value);
    const expectedFingerprint = stableKey(resolveSnapshotIds(projected.snapshot, idMap, guildId));
    const actualFingerprint = stableKey({
        roles: actual.roles,
        categories: actual.categories,
        channels: actual.channels,
    });
    return expectedFingerprint === actualFingerprint
        ? { status: 'matched', expectedFingerprint, actualFingerprint }
        : { status: 'mismatch', expectedFingerprint, actualFingerprint };
}

function resolveSnapshotIds(snapshot: Record<string, unknown>, idMap: Record<string, string>, guildId: string) {
    const sourceGuildId = typeof snapshot.guildId === 'string' ? snapshot.guildId : undefined;
    const roles = Array.isArray(snapshot.roles) ? snapshot.roles : [];
    const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
    const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
    const resolveItems = (items: unknown[]) =>
        items.map((item) => {
            if (!isObject(item) || typeof item.id !== 'string') return item;
            const permissionOverwrites = Array.isArray(item.permissionOverwrites)
                ? item.permissionOverwrites.map((overwrite: unknown) =>
                      isObject(overwrite) && typeof overwrite.id === 'string' && overwrite.type === 0
                          ? {
                                ...overwrite,
                                id: overwrite.id === sourceGuildId ? guildId : (idMap[overwrite.id] ?? overwrite.id),
                            }
                          : overwrite
                  )
                : undefined;
            return {
                ...item,
                id: idMap[item.id] ?? (item.name === '@everyone' ? guildId : item.id),
                ...(typeof item.parentId === 'string' ? { parentId: idMap[item.parentId] ?? item.parentId } : {}),
                ...(permissionOverwrites ? { permissionOverwrites } : {}),
            };
        });
    return { roles: resolveItems(roles), categories: resolveItems(categories), channels: resolveItems(channels) };
}

function stableKey(value: unknown): string {
    if (Array.isArray(value)) return JSON.stringify(value.map(stableKey).sort());
    if (isObject(value))
        return JSON.stringify(
            Object.entries(value)
                .filter(([key]) => !['exportedAt', 'guildId', 'guildName'].includes(key))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, stableKey(item)])
        );
    return JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
