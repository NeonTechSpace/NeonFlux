import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    checkpointStructureImportExecution,
    claimNextStructureImportExecution,
    completeAndCheckpointStructureImportActionAttempt,
    ensureStructureImportRestorePoint,
    finalizeStructureImportExecution,
    renewStructureImportExecutionLease,
    startStructureImportActionAttempt,
    type StructureImportActionRecord,
    type StructureImportExecutionRecord,
    type StructureImportRunRecord,
} from '@neonflux/db';
import {
    applyFluxerBotGuildStructureActions,
    normalizeFluxerGuildStructureSnapshot,
    readFluxerBotGuildStructure,
    toFluxerGuildStructureSnapshot,
} from '@neonflux/fluxer';

import { runNextStructureImportExecution } from './bot-structure-import-worker.js';

vi.mock('@neonflux/db', () => ({
    checkpointStructureImportExecution: vi.fn(),
    claimNextStructureImportExecution: vi.fn(),
    completeAndCheckpointStructureImportActionAttempt: vi.fn(),
    ensureStructureImportRestorePoint: vi.fn(),
    finalizeStructureImportExecution: vi.fn(),
    renewStructureImportExecutionLease: vi.fn(),
    startStructureImportActionAttempt: vi.fn(),
}));
vi.mock('@neonflux/fluxer', () => ({
    applyFluxerBotGuildStructureActions: vi.fn(),
    normalizeFluxerGuildStructureSnapshot: vi.fn(),
    readFluxerBotGuildStructure: vi.fn(),
    toFluxerGuildStructureSnapshot: vi.fn(),
}));

describe('structure import execution worker', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.useRealTimers());

    it('returns idle when no durable execution can be claimed', async () => {
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(ok(null));

        await expect(
            runNextStructureImportExecution({
                botToken: 'token',
                database: { db: {} } as never,
                leaseOwner: 'worker',
            })
        ).resolves.toBe('idle');
    });

    it('persists intent before mutation, checkpoints the id map, verifies, and finalizes', async () => {
        const action = {
            id: 'action-1',
            runId: 'run-1',
            sequence: 0,
            actionType: 'create',
            targetType: 'role',
            targetId: 'source-role',
            details: { label: 'Member', after: { id: 'source-role', name: 'Member' } },
            createdAt: new Date(),
        };
        const execution = {
            id: 'execution-1',
            runId: 'run-1',
            guildId: 'guild-1',
            preflightDigest: 'preflight',
            status: 'running' as const,
            nextActionSequence: 0,
            notStartedActions: 1,
            phase: 'queued' as const,
            totalActions: 1,
            totalMutationSteps: 1,
            completedMutationSteps: 0,
            appliedActions: 0,
            failedActions: 0,
            skippedActions: 0,
            idMap: {},
            retryAt: null,
            errorType: null,
            currentActionDomain: null,
            currentActionId: null,
            currentActionLabel: null,
            leaseId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            startedAt: null,
            completedAt: null,
            controlRequest: null,
            restorePointBackupId: null,
            verificationResult: null,
            verificationStatus: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(
            ok({
                execution,
                run: {
                    id: 'run-1',
                    guildId: 'guild-1',
                    policy: 'synchronize',
                    plan: { projectedSnapshot: {} },
                } as never,
                actions: [action],
                attempts: [],
            })
        );
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(ok({ id: 'attempt-1' } as never));
        vi.mocked(completeAndCheckpointStructureImportActionAttempt).mockResolvedValue(
            ok({ attempt: {} as never, execution })
        );
        vi.mocked(ensureStructureImportRestorePoint).mockResolvedValue(ok({ backupId: 'backup-1' }));
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(await input.beforeAction?.(firstAction(input.actions))).toBe(true);
            expect(checkpointStructureImportExecution).toHaveBeenLastCalledWith(
                expect.anything(),
                expect.objectContaining({ currentActionId: 'action-1', phase: 'create' })
            );
            expect(await input.beforeMutation?.()).toBe(true);
            await input.onActionResult?.(
                { id: 'action-1', status: 'applied', createdId: 'role-1' },
                {
                    'source-role': 'role-1',
                }
            );
            return ok({
                actions: [{ id: 'action-1', status: 'applied', createdId: 'role-1' }],
                idMap: { 'source-role': 'role-1' },
            });
        });
        vi.mocked(normalizeFluxerGuildStructureSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toFluxerGuildStructureSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await expect(
            runNextStructureImportExecution({
                botToken: 'token',
                database: { db: {} } as never,
                leaseOwner: 'worker',
            })
        ).resolves.toBe('progressed');
        expect(startStructureImportActionAttempt).toHaveBeenCalledBefore(
            vi.mocked(completeAndCheckpointStructureImportActionAttempt)
        );
        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ idMap: { 'source-role': 'role-1' }, phase: 'create' })
        );
        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'succeeded' })
        );
    });

    it('reuses an attached restore point without creating another one', async () => {
        const execution = workerExecution({
            restorePointBackupId: 'backup-existing',
            totalActions: 0,
            totalMutationSteps: 0,
            notStartedActions: 0,
        });
        mockClaim(execution, []);
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeFluxerGuildStructureSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toFluxerGuildStructureSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await runWorker();

        expect(ensureStructureImportRestorePoint).not.toHaveBeenCalled();
        expect(readFluxerBotGuildStructure).toHaveBeenCalledOnce();
    });

    it('persists provider retry timing without advancing the action cursor', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.(
                { id: action.id, status: 'failed', errorType: 'rate-limited', retryAfterMs: 2_500 },
                {}
            );
            return ok({
                actions: [{ id: action.id, status: 'failed', errorType: 'rate-limited', retryAfterMs: 2_500 }],
                idMap: {},
            });
        });

        await runWorker();

        expect(checkpointStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                nextActionSequence: 0,
                retryAt: new Date('2026-07-11T10:00:02.500Z'),
                status: 'waiting_rate_limit',
            })
        );
    });

    it('checkpoints a partial create id and finishes partially applied', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.(
                { id: action.id, status: 'failed', createdId: 'role-created', errorType: 'partial-create-failed' },
                { 'source-role': 'role-created' }
            );
            return ok({
                actions: [
                    { id: action.id, status: 'failed', createdId: 'role-created', errorType: 'partial-create-failed' },
                ],
                idMap: { 'source-role': 'role-created' },
            });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ idMap: { 'source-role': 'role-created' }, nextActionSequence: 1 })
        );
        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'partially_applied' })
        );
    });

    it('marks the outcome unknown when the atomic attempt completion and checkpoint cannot be persisted', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const action = workerAction();
        mockClaim(execution, [action]);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(ok({ id: 'attempt-1' } as never));
        vi.mocked(completeAndCheckpointStructureImportActionAttempt).mockResolvedValue(err({ type: 'database-error' }));
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: action.id, status: 'applied' }, {});
            return ok({ actions: [{ id: action.id, status: 'applied' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledOnce();
        expect(checkpointStructureImportExecution).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ nextActionSequence: 0, phase: 'create' })
        );
        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'outcome_unknown' })
        );
    });

    it('keeps one started action intent across nested mutations so a crash cannot replay the create', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1', totalMutationSteps: 2 });
        const action = workerAction();
        mockClaim(execution, [action]);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(ok({ id: 'attempt-1' } as never));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (providerInput) => {
            expect(await providerInput.beforeAction?.(firstAction(providerInput.actions))).toBe(true);
            expect(await providerInput.beforeMutation?.()).toBe(true);
            expect(await providerInput.beforeMutation?.()).toBe(true);
            throw new Error('simulated crash after create before overwrite');
        });

        await expect(runWorker()).rejects.toThrow('simulated crash');
        expect(startStructureImportActionAttempt).toHaveBeenCalledOnce();
        expect(completeAndCheckpointStructureImportActionAttempt).not.toHaveBeenCalled();

        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(ok(null));
        await expect(runWorker()).resolves.toBe('idle');
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledOnce();
    });

    it('honors cancel at a mutation boundary without replaying the completed action', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const cancelRequested = workerExecution({ ...execution, status: 'pause_requested', controlRequest: 'cancel' });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(cancelRequested));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).not.toHaveBeenCalled();
        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'cancelled' })
        );
    });

    it('pauses at the persisted high-water cursor', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const pauseRequested = workerExecution({ ...execution, status: 'pause_requested', controlRequest: 'pause' });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(pauseRequested));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(checkpointStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ nextActionSequence: 0, status: 'paused' })
        );
        expect(finalizeStructureImportExecution).not.toHaveBeenCalled();
    });

    it('retries an order action from its own cursor after a provider rate limit', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const orderAction = {
            ...workerAction(),
            actionType: 'update',
            targetId: null,
            targetType: 'role-order',
            details: { after: [{ sourceId: 'source-role', position: 1 }] },
        };
        mockClaim(execution, [orderAction]);
        mockMutationPersistence(execution);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.({ id: orderAction.id, actionType: 'update', targetType: 'role-order' });
            await input.beforeMutation?.();
            await input.onActionResult?.(
                { id: orderAction.id, status: 'failed', errorType: 'rate-limited', retryAfterMs: 4_000 },
                {}
            );
            return ok({
                actions: [],
                idMap: {},
                roleOrder: { status: 'failed', errorType: 'rate-limited', retryAfterMs: 4_000 },
            });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ phase: 'role_order' })
        );
        expect(checkpointStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ nextActionSequence: 0, status: 'waiting_rate_limit' })
        );
    });

    it('records full verification read failures as reconciliation work', async () => {
        const execution = workerExecution({
            restorePointBackupId: 'backup-1',
            totalActions: 0,
            totalMutationSteps: 0,
            notStartedActions: 0,
        });
        mockClaim(execution, []);
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeFluxerGuildStructureSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            err({ type: 'login-failed', error: new Error('offline') })
        );

        await runWorker();

        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                status: 'needs_reconciliation',
                verificationStatus: 'read_failed',
            })
        );
    });

    it('records a full projected snapshot mismatch as reconciliation work', async () => {
        const execution = workerExecution({
            restorePointBackupId: 'backup-1',
            totalActions: 0,
            totalMutationSteps: 0,
            notStartedActions: 0,
        });
        mockClaim(execution, []);
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeFluxerGuildStructureSnapshot).mockReturnValue({
            type: 'valid',
            snapshot: { roles: [] },
        } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toFluxerGuildStructureSnapshot).mockReturnValue({
            roles: [{ id: 'unexpected' }],
            categories: [],
            channels: [],
        } as never);

        await runWorker();

        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'needs_reconciliation', verificationStatus: 'mismatch' })
        );
    });
});

function workerExecution(overrides: Partial<StructureImportExecutionRecord> = {}): StructureImportExecutionRecord {
    return {
        id: 'execution-1',
        runId: 'run-1',
        guildId: 'guild-1',
        preflightDigest: 'preflight',
        status: 'running' as const,
        nextActionSequence: 0,
        notStartedActions: 1,
        phase: 'queued',
        totalActions: 1,
        totalMutationSteps: 1,
        completedMutationSteps: 0,
        appliedActions: 0,
        failedActions: 0,
        skippedActions: 0,
        idMap: {},
        retryAt: null,
        errorType: null,
        currentActionDomain: null,
        currentActionId: null,
        currentActionLabel: null,
        leaseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        completedAt: null,
        controlRequest: null,
        restorePointBackupId: null,
        verificationResult: null,
        verificationStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function workerAction(): StructureImportActionRecord {
    return {
        id: 'action-1',
        runId: 'run-1',
        sequence: 0,
        actionType: 'create',
        targetType: 'role',
        targetId: 'source-role',
        details: { after: { id: 'source-role', name: 'Member' } },
        createdAt: new Date(),
    };
}

function mockClaim(execution: StructureImportExecutionRecord, actions: StructureImportActionRecord[]) {
    vi.mocked(claimNextStructureImportExecution).mockResolvedValue(
        ok({
            execution,
            run: workerRun(),
            actions,
            attempts: [],
        })
    );
}

function mockMutationPersistence(execution: StructureImportExecutionRecord) {
    vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
    vi.mocked(startStructureImportActionAttempt).mockResolvedValue(ok({ id: 'attempt-1' } as never));
    vi.mocked(completeAndCheckpointStructureImportActionAttempt).mockResolvedValue(
        ok({ attempt: {} as never, execution })
    );
    vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
    vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));
}

function workerRun(): StructureImportRunRecord {
    return {
        id: 'run-1',
        guildId: 'guild-1',
        deleteActionCount: 0,
        deleteSetDigest: null,
        planDigest: 'plan-digest',
        planVersion: 2,
        policy: 'merge',
        createdByUserId: null,
        status: 'approved',
        sourceBackupId: null,
        plan: { projectedSnapshot: {} },
        requestedSnapshotDigest: 'snapshot-digest',
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function firstAction<TAction>(actions: TAction[]): TAction {
    const action = actions[0];
    if (action === undefined) throw new Error('Expected a test action.');
    return action;
}

function runWorker() {
    return runNextStructureImportExecution({ botToken: 'token', database: { db: {} } as never, leaseOwner: 'worker' });
}
