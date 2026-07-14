import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    type BlueprintPlanStepRecord,
    type BlueprintRunRecord,
    type BlueprintPlanRecord,
} from '@neonflux/db';
import {
    createBlueprintSnapshotFingerprintInput,
    deriveBlueprintCursorAuthority,
    normalizeBlueprintSnapshot,
    toBlueprintSnapshot,
    toPortableBlueprintSnapshot,
} from '@neonflux/blueprint';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { runNextBlueprintRun, startBlueprintRunWorker } from './bot-blueprint-run-worker.js';

vi.mock('@neonflux/db', () => ({
    BLUEPRINT_RUN_PROTOCOL_VERSION: 5,
    authorizeBlueprintRunMutation: vi.fn(),
    checkpointBlueprintRun: vi.fn(),
    claimNextBlueprintRun: vi.fn(),
    completeAndCheckpointBlueprintRunStepAttempt: vi.fn(),
    ensureBlueprintRunRestorePoint: vi.fn(),
    finalizeBlueprintRun: vi.fn(),
    prepareBlueprintRunStepAttempt: vi.fn(),
    renewBlueprintRunLease: vi.fn(),
    startBlueprintRunStepAttempt: vi.fn(),
}));
vi.mock('@neonflux/blueprint', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    createBlueprintSnapshotFingerprintInput: vi.fn(),
    deriveBlueprintCursorAuthority: vi.fn(),
    normalizeBlueprintSnapshot: vi.fn(),
    toBlueprintSnapshot: vi.fn(),
    toPortableBlueprintSnapshot: vi.fn(),
}));
vi.mock('@neonflux/fluxer', () => ({
    applyFluxerBotGuildStructureActions: vi.fn(),
    readFluxerBotGuildStructure: vi.fn(),
}));

describe('Blueprint run worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(deriveBlueprintCursorAuthority).mockReturnValue({
            idMap: {},
            knownTargetKinds: { 'guild-1': 'role' },
            ok: true,
        });
        vi.mocked(authorizeBlueprintRunMutation).mockResolvedValue(ok({ kind: 'authorized', run: workerRun() }));
        vi.mocked(createBlueprintSnapshotFingerprintInput).mockReturnValue({
            version: 1,
            roles: [],
            categories: [],
            channels: [],
        });
        vi.mocked(toPortableBlueprintSnapshot).mockReturnValue({
            version: 1,
            roles: [],
            categories: [],
            channels: [],
        });
    });
    afterEach(() => vi.useRealTimers());

    it('returns idle when no durable run can be claimed', async () => {
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(ok(null));

        await expect(
            runNextBlueprintRun({
                botToken: 'token',
                database: { db: {} } as never,
                leaseOwner: 'worker',
            })
        ).resolves.toBe('idle');
    });

    it('does not report a failed durable claim as idle', async () => {
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(err({ type: 'database-error' }));

        await expect(runWorker()).rejects.toThrow('blueprint-run-claim-failed');
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('reports an incompatible durable run without making Fluxer calls', async () => {
        const mismatch = runProtocolMismatch();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(ok(mismatch));

        await expect(runWorker()).resolves.toStrictEqual(mismatch);
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('logs the same durable protocol mismatch once while it remains blocked', async () => {
        vi.useFakeTimers();
        const mismatch = runProtocolMismatch();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(ok(mismatch));
        const logger = { error: vi.fn() };
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(350);
        await worker.stop();

        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            'blueprint_run.protocol_mismatch',
            expect.objectContaining({ runId: mismatch.runId })
        );
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('disables the worker after a global backend protocol mismatch', async () => {
        vi.useFakeTimers();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(err({ type: 'backend-incompatible' }));
        const logger = { error: vi.fn() };
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(500);
        await worker.stop();

        expect(claimNextBlueprintRun).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledExactlyOnceWith('blueprint_run.backend_incompatible', {
            action: 'worker_disabled',
        });
    });

    it('retries transient claim failures with bounded backoff instead of reporting idle', async () => {
        vi.useFakeTimers();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(err({ type: 'database-error' }));
        const logger = { error: vi.fn() };
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 100,
            logger: logger as never,
        });

        await vi.advanceTimersByTimeAsync(1_900);
        expect(claimNextBlueprintRun).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(200);
        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(2);
        await worker.stop();

        expect(logger.error).toHaveBeenNthCalledWith(
            1,
            'blueprint_run.worker_failed',
            expect.objectContaining({ retryAfterMs: 2_000 })
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            2,
            'blueprint_run.worker_failed',
            expect.objectContaining({ retryAfterMs: 4_000 })
        );
    });

    it('persists intent before mutation, checkpoints the id map, verifies, and finalizes', async () => {
        const action = {
            id: 'action-1',
            planId: 'plan-1',
            sequence: 0,
            actionType: 'create',
            targetType: 'role',
            targetId: 'source-role',
            details: { label: 'Member', after: workerRoleSnapshot() },
            createdAt: new Date(),
        };
        const run = workerRun();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(
            ok({
                kind: 'claimed',
                run,
                plan: {
                    id: 'plan-1',
                    guildId: 'guild-1',
                    policy: 'synchronize',
                    plan: workerPlanDocument([action], 'synchronize'),
                } as never,
                steps: [action],
                attempts: [],
            })
        );
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'pending' } as never));
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'started' } as never));
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(ok({ attempt: {} as never, run }));
        vi.mocked(ensureBlueprintRunRestorePoint).mockResolvedValue(ok({ backupId: 'backup-1' }));
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(await input.beforeAction?.(firstAction(input.actions))).toBe(true);
            expect(checkpointBlueprintRun).toHaveBeenLastCalledWith(
                expect.anything(),
                expect.objectContaining({ currentStepId: 'action-1', phase: 'create' })
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
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toBlueprintSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await expect(
            runNextBlueprintRun({
                botToken: 'token',
                database: { db: {} } as never,
                leaseOwner: 'worker',
            })
        ).resolves.toBe('progressed');
        expect(toPortableBlueprintSnapshot).toHaveBeenCalledOnce();
        expect(ensureBlueprintRunRestorePoint).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                structure: { version: 1, roles: [], categories: [], channels: [] },
            })
        );
        expect(startBlueprintRunStepAttempt).toHaveBeenCalledBefore(
            vi.mocked(completeAndCheckpointBlueprintRunStepAttempt)
        );
        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ idMap: { 'source-role': 'role-1' }, phase: 'create' })
        );
        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'succeeded' })
        );
    });

    it('reuses an attached restore point without creating another one', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            restorePointBackupId: 'backup-existing',
            notStartedSteps: 0,
        });
        mockClaim(run, [workerStep()]);
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toBlueprintSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await runWorker();

        expect(ensureBlueprintRunRestorePoint).not.toHaveBeenCalled();
        expect(readFluxerBotGuildStructure).toHaveBeenCalledOnce();
    });

    it('uses a separate post-restore read and stops before provider mutation when authorization rejects it', async () => {
        const run = workerRun();
        mockClaim(run, [workerStep()]);
        vi.mocked(ensureBlueprintRunRestorePoint).mockResolvedValue(ok({ backupId: 'backup-1' }));
        vi.mocked(readFluxerBotGuildStructure)
            .mockResolvedValueOnce(ok({ guildName: 'restore-state' } as never))
            .mockResolvedValueOnce(ok({ guildName: 'changed-before-mutation' } as never));
        vi.mocked(toPortableBlueprintSnapshot).mockReturnValueOnce({
            version: 1,
            guildName: 'restore-state',
            roles: [],
            categories: [],
            channels: [],
        });
        vi.mocked(toBlueprintSnapshot).mockReturnValueOnce({
            version: 1,
            guildName: 'changed-before-mutation',
            roles: [],
            categories: [],
            channels: [],
        });
        vi.mocked(authorizeBlueprintRunMutation).mockResolvedValue(
            ok({ kind: 'rejected', reason: 'live_fingerprint_stale', run })
        );

        await expect(runWorker()).resolves.toBe('progressed');

        expect(readFluxerBotGuildStructure).toHaveBeenCalledTimes(2);
        expect(ensureBlueprintRunRestorePoint).toHaveBeenCalledBefore(vi.mocked(authorizeBlueprintRunMutation));
        expect(vi.mocked(authorizeBlueprintRunMutation).mock.calls[0]?.[1].structure).toMatchObject({
            guildName: 'changed-before-mutation',
        });
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('persists provider retry timing without advancing the action cursor', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
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

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                nextStepSequence: 0,
                phase: 'waiting_rate_limit',
                retryAt: new Date('2026-07-11T10:00:02.500Z'),
                status: 'waiting_rate_limit',
            })
        );
    });

    it('atomically records an unknown provider outcome without advancing the create cursor', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const unknownExecution = workerRun({
            ...run,
            errorType: 'mutation-outcome-unknown:operation-failed',
            phase: 'complete',
            status: 'outcome_unknown',
        });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(
            ok({ attempt: {} as never, run: unknownExecution })
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

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ idMap: {}, nextStepSequence: 0, state: 'unknown', status: 'outcome_unknown' })
        );
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('marks the outcome unknown when the atomic attempt completion and checkpoint cannot be persisted', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const action = workerStep();
        mockClaim(run, [action]);
        vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(run));
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'pending' } as never));
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'started' } as never));
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(err({ type: 'database-error' }));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: action.id, status: 'applied' }, {});
            return ok({ actions: [{ id: action.id, status: 'applied' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(checkpointBlueprintRun).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ nextStepSequence: 0, phase: 'create' })
        );
        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'outcome_unknown' })
        );
    });

    it('atomically records outcome_unknown when the provider callback throws after an attempt starts', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const unknownExecution = workerRun({
            ...run,
            errorType: 'mutation-callback-outcome-unknown',
            phase: 'complete',
            status: 'outcome_unknown',
        });
        const action = workerStep();
        mockClaim(run, [action]);
        vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(run));
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'pending' } as never));
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'started' } as never));
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(
            ok({ attempt: {} as never, run: unknownExecution })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (providerInput) => {
            expect(await providerInput.beforeAction?.(firstAction(providerInput.actions))).toBe(true);
            expect(await providerInput.beforeMutation?.()).toBe(true);
            throw new Error('simulated callback crash after provider request');
        });

        await expect(runWorker()).resolves.toBe('progressed');
        expect(startBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                nextStepSequence: 0,
                state: 'unknown',
                status: 'outcome_unknown',
            })
        );
    });

    it('honors cancel at a mutation boundary without replaying the completed action', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const cancelRequested = workerRun({ ...run, status: 'pause_requested', controlRequest: 'cancel' });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
        vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(cancelRequested));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointBlueprintRunStepAttempt).not.toHaveBeenCalled();
        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'cancelled' })
        );
    });

    it('pauses at the persisted high-water cursor', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const pauseRequested = workerRun({ ...run, status: 'pause_requested', controlRequest: 'pause' });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
        vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(pauseRequested));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(checkpointBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ nextStepSequence: 0, status: 'paused' })
        );
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('retries an order action from its own cursor after a provider rate limit', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const orderAction = {
            ...workerStep(),
            actionType: 'update',
            targetId: 'role-order',
            targetType: 'role-order',
            details: {
                label: 'Role order',
                after: [{ sourceId: 'source-role', position: 1 }],
                changes: [{ field: 'roleOrder', after: [{ sourceId: 'source-role', position: 1 }] }],
            },
        };
        mockClaim(run, [orderAction]);
        mockMutationPersistence(run);
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

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                completedMutationSteps: 0,
                nextStepSequence: 0,
                phase: 'waiting_rate_limit',
                status: 'waiting_rate_limit',
            })
        );
    });

    it('rejects an invalid later reference graph before reading or mutating Fluxer', async () => {
        const run = workerRun();
        mockClaim(run, [workerStep()]);
        vi.mocked(deriveBlueprintCursorAuthority).mockReturnValue({
            ok: false,
            actionId: 'channel-order',
            errorType: 'structure-order-mapping-missing',
        });
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));

        await runWorker();

        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(ensureBlueprintRunRestorePoint).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeBlueprintRun).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-order-mapping-missing:channel-order',
                status: 'failed_before_mutation',
            })
        );
    });

    it('rejects a corrupt persisted Blueprint step before provider reads or mutations', async () => {
        const run = workerRun();
        const validAction = workerStep();
        const corruptAction = { ...validAction, details: { label: 'Member' } };
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(
            ok({
                kind: 'claimed',
                run,
                plan: workerPlanRecord([validAction]),
                steps: [corruptAction],
                attempts: [],
            })
        );
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));

        await expect(runWorker()).resolves.toBe('progressed');

        expect(finalizeBlueprintRun).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ errorType: 'invalid-blueprint-plan-step', status: 'failed_before_mutation' })
        );
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(ensureBlueprintRunRestorePoint).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('reports pre-provider validation failure as partial after a prior claimed mutation', async () => {
        const run = workerRun({
            appliedSteps: 1,
            nextStepSequence: 1,
            restorePointBackupId: 'backup-1',
            totalSteps: 2,
        });
        const action = { ...workerStep(), sequence: 1 };
        mockClaim(run, [action]);
        vi.mocked(deriveBlueprintCursorAuthority).mockReturnValue({
            ok: false,
            actionId: 'channel-order',
            errorType: 'structure-order-mapping-missing',
        });
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));

        await runWorker();

        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(finalizeBlueprintRun).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'partially_applied', restorePointBackupId: 'backup-1' })
        );
    });

    it('persists local normalization failures from a prepared attempt without claiming a provider outcome', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
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

        expect(prepareBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(startBlueprintRunStepAttempt).not.toHaveBeenCalled();
        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-reference-mapping-missing',
                nextStepSequence: 1,
                state: 'failed',
            })
        );
        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'structure-reference-mapping-missing',
                status: 'failed_before_mutation',
            })
        );
    });

    it('resumes at role ordering without replaying an already completed channel order', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            idMap: { 'source-channel': 'target-channel', 'source-role': 'target-role' },
            nextStepSequence: 1,
            notStartedSteps: 1,
            restorePointBackupId: 'backup-1',
            totalSteps: 2,
            totalMutationSteps: 2,
        });
        const channelOrder = {
            ...workerStep(),
            id: 'channel-order',
            sequence: 0,
            actionType: 'update',
            targetId: 'channel-order',
            targetType: 'channel-order',
            details: {
                label: 'Channel order',
                before: [],
                after: [{ sourceId: 'source-channel', parentSourceId: null, position: 0 }],
                changes: [
                    {
                        field: 'channelOrder',
                        before: [],
                        after: [{ sourceId: 'source-channel', parentSourceId: null, position: 0 }],
                    },
                ],
            },
        };
        const roleOrder = {
            ...workerStep(),
            id: 'role-order',
            sequence: 1,
            actionType: 'update',
            targetId: 'role-order',
            targetType: 'role-order',
            details: {
                label: 'Role order',
                after: [{ sourceId: 'source-role', position: 1 }],
                changes: [{ field: 'roleOrder', after: [{ sourceId: 'source-role', position: 1 }] }],
            },
        };
        mockClaim(run, [channelOrder, roleOrder]);
        mockMutationPersistence(run);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(input.actions.map((action) => action.id)).toStrictEqual(['role-order']);
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: 'role-order', status: 'applied' }, run.idMap);
            return ok({ actions: [{ id: 'role-order', status: 'applied' }], idMap: run.idMap });
        });
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toBlueprintSnapshot).mockReturnValue({ roles: [], categories: [], channels: [] } as never);

        await runWorker();

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ nextStepSequence: 2, phase: 'role_order' })
        );
    });

    it('records full verification read failures as reconciliation work', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            restorePointBackupId: 'backup-1',
            notStartedSteps: 0,
        });
        mockClaim(run, [workerStep()]);
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            err({ type: 'login-failed', error: new Error('offline') })
        );

        await runWorker();

        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                status: 'needs_reconciliation',
                verificationStatus: 'read_failed',
            })
        );
    });

    it('records a full projected snapshot mismatch as reconciliation work', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            restorePointBackupId: 'backup-1',
            notStartedSteps: 0,
        });
        mockClaim(run, [workerStep()]);
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(ok({ actions: [], idMap: {} }));
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({
            type: 'valid',
            snapshot: { roles: [] },
        } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toBlueprintSnapshot).mockReturnValue({
            roles: [{ id: 'unexpected' }],
            categories: [],
            channels: [],
        } as never);

        await runWorker();

        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'needs_reconciliation', verificationStatus: 'mismatch' })
        );
    });
});

function workerRun(overrides: Partial<BlueprintRunRecord> = {}): BlueprintRunRecord {
    return {
        id: 'run-1',
        planId: 'plan-1',
        guildId: 'guild-1',
        preflightDigest: 'preflight',
        preflightExpiresAt: new Date('2026-07-11T12:05:00.000Z'),
        preflightLiveFingerprint: 'live-fingerprint',
        mutationAuthorizedAt: null,
        mutationAuthorizationLeaseId: null,
        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        status: 'running' as const,
        nextStepSequence: 0,
        notStartedSteps: 1,
        phase: 'queued',
        totalSteps: 1,
        totalMutationSteps: 1,
        completedMutationSteps: 0,
        appliedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        idMap: {},
        retryAt: null,
        errorType: null,
        currentStepDomain: null,
        currentStepId: null,
        currentStepLabel: null,
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

function runProtocolMismatch() {
    return {
        runId: 'run-old',
        runProtocolVersion: 1,
        guildId: 'guild-1',
        kind: 'protocol_mismatch' as const,
        mayHaveExternalEffects: true,
        requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        status: 'paused',
    };
}

function workerStep(): BlueprintPlanStepRecord {
    return {
        id: 'action-1',
        planId: 'plan-1',
        sequence: 0,
        actionType: 'create',
        targetType: 'role',
        targetId: 'source-role',
        details: { label: 'Member', after: workerRoleSnapshot() },
        createdAt: new Date(),
    };
}

function workerRoleSnapshot() {
    return {
        id: 'source-role',
        name: 'Member',
        position: 1,
        hierarchyRank: 1,
        color: 0,
        permissions: '0',
        hoist: false,
        mentionable: false,
    };
}

function mockClaim(run: BlueprintRunRecord, steps: BlueprintPlanStepRecord[]) {
    vi.mocked(claimNextBlueprintRun).mockResolvedValue(
        ok({
            kind: 'claimed',
            run,
            plan: workerPlanRecord(steps),
            steps,
            attempts: [],
        })
    );
}

function mockMutationPersistence(run: BlueprintRunRecord) {
    vi.mocked(renewBlueprintRunLease).mockResolvedValue(ok(run));
    vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'pending' } as never));
    vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(ok({ id: 'attempt-1', state: 'started' } as never));
    vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(ok({ attempt: {} as never, run }));
    vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
    vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
}

function workerPlanRecord(steps: BlueprintPlanStepRecord[]): BlueprintPlanRecord {
    return {
        id: 'plan-1',
        guildId: 'guild-1',
        deleteStepCount: 0,
        deleteSetDigest: null,
        planDigest: 'plan-digest',
        planVersion: 3,
        policy: 'merge',
        createdByUserId: null,
        status: 'approved',
        sourceBackupId: null,
        plan: workerPlanDocument(steps),
        requestedSnapshotDigest: 'snapshot-digest',
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function workerPlanDocument(steps: BlueprintPlanStepRecord[], policy: 'merge' | 'synchronize' = 'merge') {
    const snapshot = { version: 1, roles: [], categories: [], channels: [] };
    const providerSteps = steps.map((step) => ({
        actionType: step.actionType,
        targetType: step.targetType,
        ...(step.targetId ? { targetId: step.targetId } : {}),
        label: typeof step.details.label === 'string' ? step.details.label : '',
        details: step.details,
    }));
    const summary = {
        creates: steps.filter((step) => step.actionType === 'create').length,
        updates: steps.filter((step) => step.actionType === 'update').length,
        deletes: steps.filter((step) => step.actionType === 'delete').length,
        roles: steps.filter((step) => step.targetType === 'role').length,
        categories: steps.filter((step) => step.targetType === 'category').length,
        channels: steps.filter((step) => step.targetType === 'channel').length,
    };
    const knownTargetKinds = { 'guild-1': 'role' as const };
    const sourceTargetMap = { 'source-role': null };
    return {
        planVersion: 3,
        policy,
        summary,
        changes: providerSteps,
        steps: providerSteps,
        knownTargetKinds,
        sourceTargetMap,
        roleProjection: {},
        projectedSnapshot: snapshot,
        fingerprintInput: {
            version: 3,
            policy,
            knownTargetKinds,
            sourceTargetMap,
            projectedSnapshot: snapshot,
            decisions: [],
            steps: providerSteps,
        },
        blockers: [],
        requestedGuildId: 'source-guild',
    };
}

function firstAction<TAction>(actions: TAction[]): TAction {
    const action = actions[0];
    if (action === undefined) throw new Error('Expected a test action.');
    return action;
}

function runWorker() {
    return runNextBlueprintRun({ botToken: 'token', database: { db: {} } as never, leaseOwner: 'worker' });
}
