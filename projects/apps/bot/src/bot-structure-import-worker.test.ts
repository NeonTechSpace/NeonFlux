import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    STRUCTURE_EXECUTION_PROTOCOL_VERSION,
    type StructureImportActionRecord,
    type StructureImportExecutionRecord,
    type StructureImportRunRecord,
} from '@neonflux/db';
import {
    applyFluxerBotGuildStructureActions,
    createFluxerGuildStructureSnapshotFingerprintInput,
    deriveFluxerBotGuildStructureCursorAuthority,
    normalizeFluxerGuildStructureSnapshot,
    readFluxerBotGuildStructure,
    toFluxerGuildStructureSnapshot,
} from '@neonflux/fluxer';

import { runNextStructureImportExecution, startStructureImportExecutionWorker } from './bot-structure-import-worker.js';

vi.mock('@neonflux/db', () => ({
    STRUCTURE_EXECUTION_PROTOCOL_VERSION: 3,
    authorizeStructureImportExecutionMutation: vi.fn(),
    checkpointStructureImportExecution: vi.fn(),
    claimNextStructureImportExecution: vi.fn(),
    completeAndCheckpointStructureImportActionAttempt: vi.fn(),
    ensureStructureImportRestorePoint: vi.fn(),
    finalizeStructureImportExecution: vi.fn(),
    prepareStructureImportActionAttempt: vi.fn(),
    renewStructureImportExecutionLease: vi.fn(),
    startStructureImportActionAttempt: vi.fn(),
}));
vi.mock('@neonflux/fluxer', () => ({
    applyFluxerBotGuildStructureActions: vi.fn(),
    createFluxerGuildStructureSnapshotFingerprintInput: vi.fn(),
    deriveFluxerBotGuildStructureCursorAuthority: vi.fn(),
    normalizeFluxerGuildStructureSnapshot: vi.fn(),
    readFluxerBotGuildStructure: vi.fn(),
    toFluxerGuildStructureSnapshot: vi.fn(),
}));

describe('structure import execution worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(deriveFluxerBotGuildStructureCursorAuthority).mockReturnValue({
            idMap: {},
            knownTargetKinds: { 'guild-1': 'role' },
            ok: true,
        });
        vi.mocked(authorizeStructureImportExecutionMutation).mockResolvedValue(
            ok({ kind: 'authorized', execution: workerExecution() })
        );
        vi.mocked(createFluxerGuildStructureSnapshotFingerprintInput).mockReturnValue({
            version: 1,
            roles: [],
            categories: [],
            channels: [],
        });
    });
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

    it('does not report a failed durable claim as idle', async () => {
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(err({ type: 'database-error' }));

        await expect(runWorker()).rejects.toThrow('structure-import-execution-claim-failed');
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('reports an incompatible durable execution without making Fluxer calls', async () => {
        const mismatch = executionProtocolMismatch();
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(ok(mismatch));

        await expect(runWorker()).resolves.toStrictEqual(mismatch);
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('logs the same durable protocol mismatch once while it remains blocked', async () => {
        vi.useFakeTimers();
        const mismatch = executionProtocolMismatch();
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(ok(mismatch));
        const logger = { error: vi.fn() };
        const worker = startStructureImportExecutionWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(350);
        await worker.stop();

        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            'structure_import.execution_protocol_mismatch',
            expect.objectContaining({ executionId: mismatch.executionId })
        );
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('disables the worker after a global backend protocol mismatch', async () => {
        vi.useFakeTimers();
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(err({ type: 'backend-incompatible' }));
        const logger = { error: vi.fn() };
        const worker = startStructureImportExecutionWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(500);
        await worker.stop();

        expect(claimNextStructureImportExecution).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledExactlyOnceWith('structure_import.backend_incompatible', {
            action: 'worker_disabled',
        });
    });

    it('retries transient claim failures with bounded backoff instead of reporting idle', async () => {
        vi.useFakeTimers();
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(err({ type: 'database-error' }));
        const logger = { error: vi.fn() };
        const worker = startStructureImportExecutionWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(1_900);
        expect(claimNextStructureImportExecution).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(200);
        expect(claimNextStructureImportExecution).toHaveBeenCalledTimes(2);
        await worker.stop();

        expect(logger.error).toHaveBeenNthCalledWith(
            1,
            'structure_import.worker_failed',
            expect.objectContaining({ retryAfterMs: 2_000 })
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            2,
            'structure_import.worker_failed',
            expect.objectContaining({ retryAfterMs: 4_000 })
        );
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
        const execution = workerExecution();
        vi.mocked(claimNextStructureImportExecution).mockResolvedValue(
            ok({
                kind: 'claimed',
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
        vi.mocked(prepareStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'pending' } as never)
        );
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'started' } as never)
        );
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
            appliedActions: 1,
            completedMutationSteps: 1,
            nextActionSequence: 1,
            restorePointBackupId: 'backup-existing',
            notStartedActions: 0,
        });
        mockClaim(execution, [workerAction()]);
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

    it('uses a separate post-restore read and stops before provider mutation when authorization rejects it', async () => {
        const execution = workerExecution();
        mockClaim(execution, [workerAction()]);
        vi.mocked(ensureStructureImportRestorePoint).mockResolvedValue(ok({ backupId: 'backup-1' }));
        vi.mocked(readFluxerBotGuildStructure)
            .mockResolvedValueOnce(ok({ guildName: 'restore-state' } as never))
            .mockResolvedValueOnce(ok({ guildName: 'changed-before-mutation' } as never));
        vi.mocked(toFluxerGuildStructureSnapshot)
            .mockReturnValueOnce({
                version: 1,
                guildName: 'restore-state',
                roles: [],
                categories: [],
                channels: [],
            })
            .mockReturnValueOnce({
                version: 1,
                guildName: 'changed-before-mutation',
                roles: [],
                categories: [],
                channels: [],
            });
        vi.mocked(authorizeStructureImportExecutionMutation).mockResolvedValue(
            ok({ kind: 'rejected', reason: 'live_fingerprint_stale', execution })
        );

        await expect(runWorker()).resolves.toBe('progressed');

        expect(readFluxerBotGuildStructure).toHaveBeenCalledTimes(2);
        expect(ensureStructureImportRestorePoint).toHaveBeenCalledBefore(
            vi.mocked(authorizeStructureImportExecutionMutation)
        );
        expect(vi.mocked(authorizeStructureImportExecutionMutation).mock.calls[0]?.[1].structure).toMatchObject({
            guildName: 'changed-before-mutation',
        });
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeStructureImportExecution).not.toHaveBeenCalled();
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

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                nextActionSequence: 0,
                phase: 'waiting_rate_limit',
                retryAt: new Date('2026-07-11T10:00:02.500Z'),
                status: 'waiting_rate_limit',
            })
        );
    });

    it('atomically records an unknown provider outcome without advancing the create cursor', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const unknownExecution = workerExecution({
            ...execution,
            errorType: 'mutation-outcome-unknown:operation-failed',
            phase: 'complete',
            status: 'outcome_unknown',
        });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(completeAndCheckpointStructureImportActionAttempt).mockResolvedValue(
            ok({ attempt: {} as never, execution: unknownExecution })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.(
                {
                    id: action.id,
                    status: 'failed',
                    errorType: 'operation-failed',
                    mutationOutcome: 'unknown',
                },
                {}
            );
            return ok({
                actions: [
                    {
                        id: action.id,
                        status: 'failed',
                        errorType: 'operation-failed',
                        mutationOutcome: 'unknown',
                    },
                ],
                idMap: {},
            });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ idMap: {}, nextActionSequence: 0, state: 'unknown', status: 'outcome_unknown' })
        );
        expect(finalizeStructureImportExecution).not.toHaveBeenCalled();
    });

    it('marks the outcome unknown when the atomic attempt completion and checkpoint cannot be persisted', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const action = workerAction();
        mockClaim(execution, [action]);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
        vi.mocked(prepareStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'pending' } as never)
        );
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'started' } as never)
        );
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

    it('atomically records outcome_unknown when the provider callback throws after an attempt starts', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const unknownExecution = workerExecution({
            ...execution,
            errorType: 'mutation-callback-outcome-unknown',
            phase: 'complete',
            status: 'outcome_unknown',
        });
        const action = workerAction();
        mockClaim(execution, [action]);
        vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
        vi.mocked(checkpointStructureImportExecution).mockResolvedValue(ok(execution));
        vi.mocked(prepareStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'pending' } as never)
        );
        vi.mocked(startStructureImportActionAttempt).mockResolvedValue(
            ok({ id: 'attempt-1', state: 'started' } as never)
        );
        vi.mocked(completeAndCheckpointStructureImportActionAttempt).mockResolvedValue(
            ok({ attempt: {} as never, execution: unknownExecution })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (providerInput) => {
            expect(await providerInput.beforeAction?.(firstAction(providerInput.actions))).toBe(true);
            expect(await providerInput.beforeMutation?.()).toBe(true);
            throw new Error('simulated callback crash after provider request');
        });

        await expect(runWorker()).resolves.toBe('progressed');
        expect(startStructureImportActionAttempt).toHaveBeenCalledOnce();
        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                nextActionSequence: 0,
                state: 'unknown',
                status: 'outcome_unknown',
            })
        );
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
                actions: [{ id: orderAction.id, status: 'failed', errorType: 'rate-limited', retryAfterMs: 4_000 }],
                idMap: {},
            });
        });

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                completedMutationSteps: 0,
                nextActionSequence: 0,
                phase: 'waiting_rate_limit',
                status: 'waiting_rate_limit',
            })
        );
    });

    it('rejects an invalid later reference graph before reading or mutating Fluxer', async () => {
        const execution = workerExecution();
        mockClaim(execution, [workerAction()]);
        vi.mocked(deriveFluxerBotGuildStructureCursorAuthority).mockReturnValue({
            ok: false,
            actionId: 'channel-order',
            errorType: 'structure-order-mapping-missing',
        });
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));

        await runWorker();

        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(ensureStructureImportRestorePoint).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeStructureImportExecution).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-order-mapping-missing:channel-order',
                status: 'failed_before_mutation',
            })
        );
    });

    it('reports pre-provider validation failure as partial after a prior claimed mutation', async () => {
        const execution = workerExecution({
            appliedActions: 1,
            nextActionSequence: 1,
            restorePointBackupId: 'backup-1',
            totalActions: 2,
        });
        const action = { ...workerAction(), sequence: 1 };
        mockClaim(execution, [action]);
        vi.mocked(deriveFluxerBotGuildStructureCursorAuthority).mockReturnValue({
            ok: false,
            actionId: 'channel-order',
            errorType: 'structure-order-mapping-missing',
        });
        vi.mocked(finalizeStructureImportExecution).mockResolvedValue(ok(execution));

        await runWorker();

        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeStructureImportExecution).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'partially_applied', restorePointBackupId: 'backup-1' })
        );
    });

    it('persists local normalization failures from a prepared attempt without claiming a provider outcome', async () => {
        const execution = workerExecution({ restorePointBackupId: 'backup-1' });
        const action = workerAction();
        mockClaim(execution, [action]);
        mockMutationPersistence(execution);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.onActionResult?.(
                { id: action.id, status: 'failed', errorType: 'structure-reference-mapping-missing' },
                {}
            );
            return ok({
                actions: [{ id: action.id, status: 'failed', errorType: 'structure-reference-mapping-missing' }],
                idMap: {},
            });
        });

        await runWorker();

        expect(prepareStructureImportActionAttempt).toHaveBeenCalledOnce();
        expect(startStructureImportActionAttempt).not.toHaveBeenCalled();
        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-reference-mapping-missing',
                nextActionSequence: 1,
                state: 'failed',
            })
        );
        expect(finalizeStructureImportExecution).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-reference-mapping-missing',
                status: 'failed_before_mutation',
            })
        );
    });

    it('resumes at role ordering without replaying an already completed channel order', async () => {
        const execution = workerExecution({
            appliedActions: 1,
            completedMutationSteps: 1,
            idMap: { 'source-channel': 'target-channel', 'source-role': 'target-role' },
            nextActionSequence: 1,
            notStartedActions: 1,
            restorePointBackupId: 'backup-1',
            totalActions: 2,
            totalMutationSteps: 2,
        });
        const channelOrder = {
            ...workerAction(),
            id: 'channel-order',
            sequence: 0,
            actionType: 'update',
            targetId: null,
            targetType: 'channel-order',
            details: { after: [{ sourceId: 'source-channel', parentSourceId: null, position: 0 }] },
        };
        const roleOrder = {
            ...workerAction(),
            id: 'role-order',
            sequence: 1,
            actionType: 'update',
            targetId: null,
            targetType: 'role-order',
            details: { after: [{ sourceId: 'source-role', position: 1 }] },
        };
        mockClaim(execution, [channelOrder, roleOrder]);
        mockMutationPersistence(execution);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(input.actions.map((action) => action.id)).toStrictEqual(['role-order']);
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: 'role-order', status: 'applied' }, execution.idMap);
            return ok({ actions: [{ id: 'role-order', status: 'applied' }], idMap: execution.idMap });
        });
        vi.mocked(normalizeFluxerGuildStructureSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toFluxerGuildStructureSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await runWorker();

        expect(completeAndCheckpointStructureImportActionAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ nextActionSequence: 2, phase: 'role_order' })
        );
    });

    it('records full verification read failures as reconciliation work', async () => {
        const execution = workerExecution({
            appliedActions: 1,
            completedMutationSteps: 1,
            nextActionSequence: 1,
            restorePointBackupId: 'backup-1',
            notStartedActions: 0,
        });
        mockClaim(execution, [workerAction()]);
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
            appliedActions: 1,
            completedMutationSteps: 1,
            nextActionSequence: 1,
            restorePointBackupId: 'backup-1',
            notStartedActions: 0,
        });
        mockClaim(execution, [workerAction()]);
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
        preflightExpiresAt: new Date('2026-07-11T12:05:00.000Z'),
        preflightLiveFingerprint: 'live-fingerprint',
        mutationAuthorizedAt: null,
        mutationAuthorizationLeaseId: null,
        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
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

function executionProtocolMismatch() {
    return {
        executionId: 'execution-old',
        executionProtocolVersion: 1,
        guildId: 'guild-1',
        kind: 'protocol_mismatch' as const,
        mayHaveExternalEffects: true,
        requiredProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        status: 'paused',
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
            kind: 'claimed',
            execution,
            run: workerRun(),
            actions,
            attempts: [],
        })
    );
}

function mockMutationPersistence(execution: StructureImportExecutionRecord) {
    vi.mocked(renewStructureImportExecutionLease).mockResolvedValue(ok(execution));
    vi.mocked(prepareStructureImportActionAttempt).mockResolvedValue(
        ok({ id: 'attempt-1', state: 'pending' } as never)
    );
    vi.mocked(startStructureImportActionAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'started' } as never));
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
        planVersion: 3,
        policy: 'merge',
        createdByUserId: null,
        status: 'approved',
        sourceBackupId: null,
        plan: {
            knownTargetKinds: { 'guild-1': 'role' },
            projectedSnapshot: {},
            requestedGuildId: 'source-guild',
            sourceTargetMap: { 'source-role': null },
        },
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
