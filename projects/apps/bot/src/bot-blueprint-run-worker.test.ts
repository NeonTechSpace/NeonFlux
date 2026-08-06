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
    startBlueprintRunStepAttempt,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    type BlueprintRunRecord,
} from '@neonflux/db';
import { deriveBlueprintCursorAuthority, normalizeBlueprintSnapshot, toBlueprintSnapshot } from '@neonflux/blueprint';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { validateClaimedBlueprintRunAuthority } from './bot-blueprint-run-authority.js';
import { runNextBlueprintRun } from './bot-blueprint-run-executor.js';
import { startBlueprintRunWorker } from './bot-blueprint-run-worker.js';

vi.mock('@neonflux/db', () => ({
    BLUEPRINT_RUN_PROTOCOL_VERSION: 7,
    authorizeBlueprintRunMutation: vi.fn(),
    checkpointBlueprintRun: vi.fn(),
    claimNextBlueprintRun: vi.fn(),
    completeAndCheckpointBlueprintRunStepAttempt: vi.fn(),
    ensureBlueprintRunRestorePoint: vi.fn(),
    finalizeBlueprintRun: vi.fn(),
    prepareBlueprintRunStepAttempt: vi.fn(),
    startBlueprintRunStepAttempt: vi.fn(),
}));
vi.mock('@neonflux/blueprint', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    deriveBlueprintCursorAuthority: vi.fn(),
    normalizeBlueprintSnapshot: vi.fn(),
    toBlueprintSnapshot: vi.fn(),
}));
vi.mock('./bot-blueprint-run-authority.js', () => ({
    validateClaimedBlueprintRunAuthority: vi.fn(),
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
        vi.mocked(validateClaimedBlueprintRunAuthority).mockImplementation((claim) =>
            Promise.resolve(validAuthority((claim as unknown as { steps: TestPlanStep[] }).steps))
        );
        vi.mocked(toBlueprintSnapshot).mockReturnValue({
            version: 1,
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        } as never);
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

    it('accepts a server-quarantined invalid authority without retrying or provider access', async () => {
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(
            ok({
                kind: 'authority_invalid',
                errorType: 'blueprint-plan-integrity-mismatch',
                guildId: 'guild-1',
                mayHaveExternalEffects: false,
                runId: 'run-1',
                status: 'failed_before_mutation',
            })
        );

        await expect(runWorker()).resolves.toBe('progressed');
        expect(validateClaimedBlueprintRunAuthority).not.toHaveBeenCalled();
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('fails closed if an older protocol is ever returned as claimed', async () => {
        const run = workerRun({ protocolVersion: 6 });
        mockClaim(run, [workerStep()]);

        await expect(runWorker()).resolves.toMatchObject({
            kind: 'protocol_mismatch',
            runId: 'run-1',
            runProtocolVersion: 6,
            requiredProtocolVersion: 7,
        });
        expect(validateClaimedBlueprintRunAuthority).not.toHaveBeenCalled();
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
            expect.objectContaining({ errorType: 'Error', retryAfterMs: 2_000 })
        );
        expect(logger.error).toHaveBeenNthCalledWith(
            2,
            'blueprint_run.worker_failed',
            expect.objectContaining({ errorType: 'Error', retryAfterMs: 4_000 })
        );
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain('blueprint-run-claim-failed');
    });

    it('backs off repeated idle polls and returns to the base delay after progress', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        vi.mocked(claimNextBlueprintRun)
            .mockResolvedValueOnce(ok(null))
            .mockResolvedValueOnce(ok(null))
            .mockResolvedValueOnce(
                ok({
                    kind: 'authority_invalid',
                    errorType: 'blueprint-plan-integrity-mismatch',
                    guildId: 'guild-1',
                    mayHaveExternalEffects: false,
                    runId: 'run-1',
                    status: 'failed_before_mutation',
                })
            )
            .mockResolvedValue(ok(null));
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            logger: { error: vi.fn() } as never,
        });

        await vi.advanceTimersByTimeAsync(1_999);
        expect(claimNextBlueprintRun).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(4);
        await worker.stop();
    });

    it('cancels an idle timer when woken', async () => {
        vi.useFakeTimers();
        vi.mocked(claimNextBlueprintRun).mockResolvedValue(ok(null));
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 60_000,
            logger: { error: vi.fn() } as never,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(claimNextBlueprintRun).toHaveBeenCalledOnce();

        worker.wake();
        await vi.advanceTimersByTimeAsync(0);

        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(2);
        await worker.stop();
    });

    it('coalesces repeated wakes during active work into one replay', async () => {
        vi.useFakeTimers();
        const firstClaim = Promise.withResolvers<Awaited<ReturnType<typeof claimNextBlueprintRun>>>();
        vi.mocked(claimNextBlueprintRun).mockReturnValueOnce(firstClaim.promise).mockResolvedValue(ok(null));
        const worker = startBlueprintRunWorker({
            botToken: 'token',
            database: { db: {} } as never,
            intervalMs: 60_000,
            logger: { error: vi.fn() } as never,
        });
        expect(claimNextBlueprintRun).toHaveBeenCalledOnce();

        worker.wake();
        worker.wake();
        worker.wake();
        firstClaim.resolve(ok(null));
        await vi.advanceTimersByTimeAsync(0);

        expect(claimNextBlueprintRun).toHaveBeenCalledTimes(2);
        await worker.stop();
    });

    it('persists intent before mutation, records the created mapping, verifies, and finalizes', async () => {
        const action: TestPlanStep = {
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
                plan: workerPlanRecord([action], 'synchronize'),
                steps: [action],
                attempts: [],
            } as never)
        );
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'prepared', attempt: { id: 'attempt-1', state: 'pending' } as never, run })
        );
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'started', attempt: { id: 'attempt-1', state: 'started' } as never, run })
        );
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(ok({ attempt: {} as never, run }));
        vi.mocked(ensureBlueprintRunRestorePoint).mockResolvedValue(
            ok({ backupId: 'backup-1', snapshotDigest: 'a'.repeat(64) })
        );
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(await input.beforeAction?.(firstAction(input.actions))).toBe(true);
            expect(prepareBlueprintRunStepAttempt).toHaveBeenLastCalledWith(
                expect.anything(),
                expect.objectContaining({ planStepId: 'action-1' })
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
        vi.mocked(toBlueprintSnapshot).mockReturnValue({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        } as never);

        await expect(
            runNextBlueprintRun({
                botToken: 'token',
                database: { db: {} } as never,
                leaseOwner: 'worker',
            })
        ).resolves.toBe('progressed');
        const restorePointInput: unknown = vi.mocked(ensureBlueprintRunRestorePoint).mock.calls[0]?.[1];
        expect(restorePointInput).toMatchObject({ structure: { guildId: 'guild-1' } });
        expect(startBlueprintRunStepAttempt).toHaveBeenCalledBefore(
            vi.mocked(completeAndCheckpointBlueprintRunStepAttempt)
        );
        expect(prepareBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(startBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ createdId: 'role-1', phase: 'create' })
        );
        expect(checkpointBlueprintRun).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ phase: 'verifying', status: 'verifying' })
        );
        expect(finalizeBlueprintRun).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'succeeded' })
        );
        const finalization: unknown = vi.mocked(finalizeBlueprintRun).mock.calls.at(-1)?.[1];
        if (!finalization || typeof finalization !== 'object')
            throw new Error('Expected Blueprint finalization input.');
        const verificationEvidenceDigest = (finalization as Record<string, unknown>).verificationEvidenceDigest;
        expect(verificationEvidenceDigest).toMatch(/^[0-9a-f]{64}$/u);
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
        vi.mocked(toBlueprintSnapshot).mockReturnValue({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        } as never);

        await runWorker();

        expect(ensureBlueprintRunRestorePoint).not.toHaveBeenCalled();
        expect(readFluxerBotGuildStructure).toHaveBeenCalledOnce();
    });

    it('uses a separate post-restore read and stops before provider mutation when authorization rejects it', async () => {
        const run = workerRun();
        mockClaim(run, [workerStep()]);
        vi.mocked(ensureBlueprintRunRestorePoint).mockResolvedValue(
            ok({ backupId: 'backup-1', snapshotDigest: 'a'.repeat(64) })
        );
        vi.mocked(readFluxerBotGuildStructure)
            .mockResolvedValueOnce(ok({ guildName: 'restore-state' } as never))
            .mockResolvedValueOnce(ok({ guildName: 'changed-before-mutation' } as never));
        vi.mocked(toBlueprintSnapshot)
            .mockReturnValueOnce({
                version: 1,
                guildId: 'guild-1',
                guildName: 'restore-state',
                roles: [],
                categories: [],
                channels: [],
            })
            .mockReturnValueOnce({
                version: 1,
                guildId: 'guild-1',
                guildName: 'changed-before-mutation',
                roles: [],
                categories: [],
                channels: [],
            });
        vi.mocked(authorizeBlueprintRunMutation).mockResolvedValue(
            ok({ kind: 'rejected', reason: 'structure_changed', run })
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
            expect.objectContaining({ nextStepSequence: 0, state: 'unknown', status: 'outcome_unknown' })
        );
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('marks the outcome unknown when the atomic attempt completion and checkpoint cannot be persisted', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const action = workerStep();
        mockClaim(run, [action]);
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'prepared', attempt: { id: 'attempt-1', state: 'pending' } as never, run })
        );
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'started', attempt: { id: 'attempt-1', state: 'started' } as never, run })
        );
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(err({ type: 'database-error' }));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: action.id, status: 'applied' }, {});
            return ok({ actions: [{ id: action.id, status: 'applied' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledTimes(2);
        expect(checkpointBlueprintRun).not.toHaveBeenCalled();
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
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'prepared', attempt: { id: 'attempt-1', state: 'pending' } as never, run })
        );
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'started', attempt: { id: 'attempt-1', state: 'started' } as never, run })
        );
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
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
            ok({
                kind: 'control_requested',
                attempt: { id: 'attempt-1', state: 'pending' } as never,
                run: cancelRequested,
            })
        );
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(
            ok({ attempt: {} as never, run: workerRun({ ...cancelRequested, status: 'cancelled' }) })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(completeAndCheckpointBlueprintRunStepAttempt).toHaveBeenCalledOnce();
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('pauses at the persisted high-water cursor', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const pauseRequested = workerRun({ ...run, status: 'pause_requested', controlRequest: 'pause' });
        const action = workerStep();
        mockClaim(run, [action]);
        mockMutationPersistence(run);
        vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
            ok({
                kind: 'control_requested',
                attempt: { id: 'attempt-1', state: 'pending' } as never,
                run: pauseRequested,
            })
        );
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(
            ok({ attempt: {} as never, run: workerRun({ ...pauseRequested, status: 'paused' }) })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            await input.beforeAction?.(firstAction(input.actions));
            expect(await input.beforeMutation?.()).toBe(false);
            await input.onActionResult?.({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }, {});
            return ok({ actions: [{ id: action.id, status: 'failed', errorType: 'apply-lease-lost' }], idMap: {} });
        });

        await runWorker();

        expect(checkpointBlueprintRun).not.toHaveBeenCalled();
        expect(finalizeBlueprintRun).not.toHaveBeenCalled();
    });

    it('retries an order action from its own cursor after a provider rate limit', async () => {
        const run = workerRun({ restorePointBackupId: 'backup-1' });
        const orderAction: TestPlanStep = {
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
            } as never)
        );
        vi.mocked(validateClaimedBlueprintRunAuthority).mockResolvedValueOnce({
            type: 'invalid',
            errorType: 'invalid-blueprint-plan-step-ledger',
        });
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));

        await expect(runWorker()).resolves.toBe('progressed');

        expect(finalizeBlueprintRun).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                errorType: 'invalid-blueprint-plan-step-ledger',
                status: 'failed_before_mutation',
            })
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
            expect.objectContaining({ status: 'partially_applied' })
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

    it('reuses the exact pending attempt across repeated reclaim before provider start', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            notStartedSteps: 1,
            restorePointBackupId: 'backup-1',
            totalSteps: 2,
            totalMutationSteps: 2,
        });
        const action = { ...workerStep(), sequence: 1 };
        const pendingAttempt = {
            id: 'attempt-4',
            attempt: 4,
            planStepId: action.id,
            requestKey: 'stable-pending-request-key',
            state: 'pending',
        };
        const olderPendingAttempt = {
            ...pendingAttempt,
            id: 'attempt-3',
            attempt: 3,
            requestKey: 'older-pending-request-key',
        };
        mockClaim(run, [action], {}, [pendingAttempt, olderPendingAttempt]);
        vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(
            ok({ kind: 'prepared', attempt: pendingAttempt as never, run })
        );
        vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(err({ type: 'database-error' }));
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(await input.beforeAction?.(firstAction(input.actions))).toBe(true);
            throw new Error('simulated process loss before provider start');
        });

        await expect(runWorker()).resolves.toBe('progressed');
        await expect(runWorker()).resolves.toBe('progressed');

        expect(prepareBlueprintRunStepAttempt).toHaveBeenCalledTimes(2);
        for (const [, input] of vi.mocked(prepareBlueprintRunStepAttempt).mock.calls) {
            expect(input).toMatchObject({
                attempt: 4,
                planStepId: action.id,
                requestKey: 'stable-pending-request-key',
            });
        }
        expect(startBlueprintRunStepAttempt).not.toHaveBeenCalled();
    });

    it('resumes at role ordering without replaying an already completed channel order', async () => {
        const resumedIdMap = { 'source-channel': 'target-channel', 'source-role': 'target-role' };
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            notStartedSteps: 1,
            restorePointBackupId: 'backup-1',
            totalSteps: 2,
            totalMutationSteps: 2,
        });
        const channelOrder: TestPlanStep = {
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
        const roleOrder: TestPlanStep = {
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
        mockClaim(run, [channelOrder, roleOrder], resumedIdMap);
        mockMutationPersistence(run);
        vi.mocked(applyFluxerBotGuildStructureActions).mockImplementation(async (input) => {
            expect(input.actions.map((action) => action.id)).toStrictEqual(['role-order']);
            await input.beforeAction?.(firstAction(input.actions));
            await input.beforeMutation?.();
            await input.onActionResult?.({ id: 'role-order', status: 'applied' }, resumedIdMap);
            return ok({ actions: [{ id: 'role-order', status: 'applied' }], idMap: resumedIdMap });
        });
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok({} as never));
        vi.mocked(toBlueprintSnapshot).mockReturnValue({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        } as never);

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
            err({ type: 'authentication-failed', error: new Error('offline') })
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
            guildId: 'guild-1',
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

    it('surfaces terminal verification persistence failures', async () => {
        const run = workerRun({
            appliedSteps: 1,
            completedMutationSteps: 1,
            nextStepSequence: 1,
            restorePointBackupId: 'backup-1',
            notStartedSteps: 0,
        });
        mockClaim(run, [workerStep()]);
        vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
        vi.mocked(finalizeBlueprintRun).mockResolvedValue(err({ type: 'database-error' }));
        vi.mocked(normalizeBlueprintSnapshot).mockReturnValue({ type: 'valid', snapshot: {} } as never);
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            err({ type: 'authentication-failed', error: new Error('offline') })
        );

        await expect(runWorker()).rejects.toThrow('blueprint-run-finalize-failed');
    });
});

function workerRun(overrides: Partial<BlueprintRunRecord> = {}): BlueprintRunRecord {
    return {
        id: 'run-1',
        planId: 'plan-1',
        guildId: 'guild-1',
        preflightId: 'preflight-1',
        preflightDigest: 'preflight',
        preflightExpiresAt: new Date('2026-07-11T12:05:00.000Z'),
        fingerprintVersion: 2,
        expectedStructureFingerprint: 'structure-fingerprint',
        expectedCapabilityFingerprint: 'capability-fingerprint',
        executionAuthorityDigest: 'a'.repeat(64),
        authorizationDecision: null,
        authorizationMismatch: null,
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
        restorePointSnapshotDigest: null,
        verificationStatus: null,
        verificationEvidenceVersion: null,
        verificationEvidenceDigest: null,
        terminalDigest: null,
        terminalRequestDigest: null,
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

type TestPlanStep = {
    id: string;
    planId: string;
    sequence: number;
    actionType: 'create' | 'update' | 'delete';
    targetType: string;
    targetId: string | null;
    details: Record<string, unknown> & { label: string };
    createdAt: Date;
};

function workerStep(): TestPlanStep {
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

function mockClaim(
    run: BlueprintRunRecord,
    steps: TestPlanStep[],
    cursorIdMap: Record<string, string> = {},
    attempts: unknown[] = []
) {
    vi.mocked(claimNextBlueprintRun).mockResolvedValue(
        ok({
            kind: 'claimed',
            run,
            plan: workerPlanRecord(steps),
            authority: {},
            executionAuthority: {},
            cursor: {},
            steps,
            decisions: [],
            attempts,
        } as never)
    );
    vi.mocked(validateClaimedBlueprintRunAuthority).mockResolvedValueOnce(validAuthority(steps, cursorIdMap));
}

function mockMutationPersistence(run: BlueprintRunRecord) {
    vi.mocked(prepareBlueprintRunStepAttempt).mockResolvedValue(
        ok({ kind: 'prepared', attempt: { id: 'attempt-1', state: 'pending' } as never, run })
    );
    vi.mocked(startBlueprintRunStepAttempt).mockResolvedValue(
        ok({ kind: 'started', attempt: { id: 'attempt-1', state: 'started' } as never, run })
    );
    vi.mocked(completeAndCheckpointBlueprintRunStepAttempt).mockResolvedValue(ok({ attempt: {} as never, run }));
    vi.mocked(checkpointBlueprintRun).mockResolvedValue(ok(run));
    vi.mocked(finalizeBlueprintRun).mockResolvedValue(ok(run));
}

function workerPlanRecord(steps: TestPlanStep[], policy: 'merge' | 'synchronize' = 'merge') {
    const digest = '0'.repeat(64);
    return {
        id: 'plan-1',
        guildId: 'guild-1',
        sourceBackupId: null,
        deleteStepCount: 0,
        deleteSetDigest: null,
        planDigest: digest,
        planVersion: 4,
        policy,
        createdByUserId: null,
        status: 'approved',
        summary: {
            creates: steps.filter((step) => step.actionType === 'create').length,
            updates: steps.filter((step) => step.actionType === 'update').length,
            deletes: steps.filter((step) => step.actionType === 'delete').length,
            roles: steps.filter((step) => step.targetType === 'role').length,
            categories: steps.filter((step) => step.targetType === 'category').length,
            channels: steps.filter((step) => step.targetType === 'channel').length,
        },
        decisionSummary: {
            noOp: 0,
            create: 0,
            update: 0,
            delete: 0,
            protectedRetained: 0,
            protectedOmitted: 0,
            unmanagedRetained: 0,
            blockedAmbiguous: 0,
            blockedUnsupported: 0,
        },
        blockerCount: 0,
        requestedSnapshotDigest: digest,
        projectedSnapshotDigest: digest,
        authorityVersion: 1,
        authorityDigest: digest,
        executionAuthorityVersion: 1,
        executionAuthorityDigest: digest,
        stepCount: steps.length,
        stepLedgerDigest: digest,
        decisionCount: 0,
        decisionLedgerDigest: digest,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function validAuthority(steps: TestPlanStep[], idMap: Record<string, string> = {}) {
    const snapshot = { version: 1 as const, roles: [], categories: [], channels: [] };
    return {
        type: 'valid' as const,
        value: {
            authority: { projectedSnapshot: snapshot },
            executionAuthority: {
                sourceGuildId: 'source-guild',
                sourceTargetMap: { 'source-role': null },
                knownTargetKinds: { 'guild-1': 'role' as const },
                initialIdMap: {},
            },
            cursor: { idMap },
            steps,
            decisions: [],
        },
    } as never;
}

function firstAction<TAction>(actions: TAction[]): TAction {
    const action = actions[0];
    if (action === undefined) throw new Error('Expected a test action.');
    return action;
}

function runWorker() {
    return runNextBlueprintRun({ botToken: 'token', database: { db: {} } as never, leaseOwner: 'worker' });
}
