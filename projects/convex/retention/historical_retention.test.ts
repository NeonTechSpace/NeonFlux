import { describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintPlanStep } from '../blueprint/blueprint.js';
import { enqueueBlueprintRun } from '../blueprint/blueprint_plan_review.js';
import {
    deletableBlueprintRunStatuses,
    executeHistoricalRetentionBatch,
    historicalRetentionBatchSize,
    isDeletableBlueprintRunStatus,
    isProtectedBlueprintRunStatus,
    protectedBlueprintRunStatuses,
    type HistoricalRetentionOperations,
} from './historical_retention.js';

const now = '2026-07-14T12:00:00.000Z';
const cutoff = '2026-04-15T12:00:00.000Z';
const oldRunUpdatedAt = '2026-04-15T11:59:59.999Z';
type TestMutation = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

describe('historical retention', () => {
    it('partitions actual run statuses into deletable and protected ownership', () => {
        const statuses = [
            'queued',
            'running',
            'waiting_rate_limit',
            'pause_requested',
            'paused',
            'verifying',
            'succeeded',
            'partially_applied',
            'failed_before_mutation',
            'needs_reconciliation',
            'outcome_unknown',
            'cancelled',
        ];

        expect(statuses.filter(isProtectedBlueprintRunStatus)).toStrictEqual([...protectedBlueprintRunStatuses]);
        expect(statuses.filter(isDeletableBlueprintRunStatus)).toStrictEqual([...deletableBlueprintRunStatuses]);
        expect(
            statuses.every((status) => isProtectedBlueprintRunStatus(status) !== isDeletableBlueprintRunStatus(status))
        ).toBe(true);
    });

    it('rejects invalid policy before reading or deleting historical rows', async () => {
        const operations = createOperations();

        await expect(
            executeHistoricalRetentionBatch(operations, {
                now,
                retentionDays: 0,
            })
        ).rejects.toThrow('data-retention-days-out-of-range');

        expect(operations.loadExpiredAuditEventIds).not.toHaveBeenCalled();
        expect(operations.deleteAuditEventIds).not.toHaveBeenCalled();
        expect(operations.schedule).not.toHaveBeenCalled();
    });

    it('deletes one bounded audit page and keeps the original cutoff through continuation', async () => {
        const expiredIds = Array.from(
            { length: historicalRetentionBatchSize + 1 },
            (_, index) => `event-${String(index)}`
        );
        const operations = createOperations({
            loadExpiredAuditEventIds: vi.fn(() => Promise.resolve(expiredIds)),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now });

        expect(operations.loadExpiredAuditEventIds).toHaveBeenCalledWith(cutoff, historicalRetentionBatchSize + 1);
        expect(operations.deleteAuditEventIds).toHaveBeenCalledWith(expiredIds.slice(0, historicalRetentionBatchSize));
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({ cutoff, phase: 'audit-events' });
    });

    it('advances from drained audit history into Blueprint selection', async () => {
        const operations = createOperations({
            loadExpiredAuditEventIds: vi.fn(() => Promise.resolve(['event-1'])),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now });

        expect(operations.deleteAuditEventIds).toHaveBeenCalledWith(['event-1']);
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({ cutoff, phase: 'blueprint-plan-select' });
    });

    it('skips a protected plan and continues from its page cursor', async () => {
        const operations = createOperations({
            claimExpiredPlan: vi.fn(() => Promise.resolve(false)),
            loadNextExpiredPlan: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-protected', isDone: false, planId: 'plan-protected' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-plan-select' });

        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-select',
            scanCursor: 'after-protected',
        });
        expect(operations.deletePlan).not.toHaveBeenCalled();
    });

    it('stops cleanly when the protected candidate is the final page', async () => {
        const operations = createOperations({
            claimExpiredPlan: vi.fn(() => Promise.resolve(false)),
            loadNextExpiredPlan: vi.fn(() =>
                Promise.resolve({ continueCursor: 'end', isDone: true, planId: 'plan-protected' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-plan-select' });

        expect(operations.schedule).not.toHaveBeenCalled();
    });

    it('carries the selector cursor across deletion of its current candidate', async () => {
        const operations = createOperations({
            findRemainingPlanPhase: vi.fn(() => Promise.resolve(null)),
            loadNextExpiredPlan: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-deleted', isDone: true, planId: 'plan-old' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-plan-select' });
        expect(operations.schedule).toHaveBeenLastCalledWith({
            cutoff,
            phase: 'blueprint-runs',
            planId: 'plan-old',
            scanCursor: 'after-deleted',
        });

        vi.mocked(operations.schedule).mockClear();
        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan',
            planId: 'plan-old',
            scanCursor: 'after-deleted',
        });

        expect(operations.deletePlan).toHaveBeenCalledExactlyOnceWith('plan-old');
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-select',
            scanCursor: 'after-deleted',
        });
    });

    it('claims the plan obsolete before scheduling its first child drain', async () => {
        let runStatus = 'approved';
        const operations = createOperations({
            claimExpiredPlan: vi.fn(() => {
                runStatus = 'obsolete';
                return Promise.resolve(true);
            }),
            loadNextExpiredPlan: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-claimed', isDone: false, planId: 'plan-old' })
            ),
            loadPlanState: vi.fn(() => Promise.resolve({ status: runStatus, updatedAt: oldRunUpdatedAt })),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-plan-select' });

        expect(runStatus).toBe('obsolete');
        expect(vi.mocked(operations.claimExpiredPlan).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(operations.schedule).mock.invocationCallOrder[0] ?? 0
        );
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-runs',
            planId: 'plan-old',
            scanCursor: 'after-claimed',
        });

        const previousIssuer = process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER;
        process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER = 'https://retention.test.invalid/';
        const claimedRunContext = {
            auth: {
                getUserIdentity: () =>
                    Promise.resolve({
                        issuer: 'https://retention.test.invalid/',
                        subject: 'retention-test',
                        tokenIdentifier: 'retention-test',
                        'neonflux.kind': 'service',
                        'neonflux.serviceName': 'web',
                    }),
            },
            db: {
                get: () => Promise.resolve({ _id: 'plan-old', status: runStatus }),
            },
        };
        const enqueueHandler = (enqueueBlueprintRun as unknown as TestMutation)._handler;
        const recordActionHandler = (recordBlueprintPlanStep as unknown as TestMutation)._handler;
        try {
            await expect(
                enqueueHandler(claimedRunContext, {
                    now,
                    preflightDigest: 'digest',
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                    planId: 'plan-old',
                })
            ).rejects.toThrow('blueprint-run-plan-not-approved');
            await expect(
                recordActionHandler(claimedRunContext, {
                    actionType: 'create_channel',
                    planId: 'plan-old',
                    sequence: 0,
                    targetType: 'channel',
                })
            ).rejects.toThrow('blueprint-plan-step-ledger-immutable');
        } finally {
            if (previousIssuer === undefined) delete process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER;
            else process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER = previousIssuer;
        }

        vi.mocked(operations.schedule).mockClear();
        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
            scanCursor: 'after-claimed',
        });

        expect(operations.loadBlueprintPlanChildIds).toHaveBeenCalled();
    });

    it('deletes attempts before their terminal run and then repeats that phase', async () => {
        const operations = createOperations({
            loadRunStepAttemptIds: vi.fn().mockResolvedValueOnce(['attempt-1', 'attempt-2']).mockResolvedValueOnce([]),
            loadFirstRun: vi.fn(() => Promise.resolve({ id: 'run-1', status: 'succeeded' })),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-runs',
            planId: 'plan-old',
        });

        expect(operations.deleteBlueprintChildIds).toHaveBeenCalledWith('blueprint-run-step-attempts', [
            'attempt-1',
            'attempt-2',
        ]);
        expect(operations.deleteRun).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-runs',
            planId: 'plan-old',
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-runs',
            planId: 'plan-old',
        });
        expect(operations.deleteRun).toHaveBeenCalledExactlyOnceWith('run-1');
    });

    it('deletes durable run observations before deleting their terminal run', async () => {
        const operations = createOperations({
            loadFirstRun: vi.fn(() => Promise.resolve({ id: 'run-1', status: 'failed_before_mutation' })),
            loadRunObservationIds: vi.fn(() => Promise.resolve(['observation-restore', 'observation-authorization'])),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-runs',
            planId: 'plan-old',
        });

        expect(operations.deleteRunObservationIds).toHaveBeenCalledWith([
            'observation-restore',
            'observation-authorization',
        ]);
        expect(operations.deleteRun).toHaveBeenCalledExactlyOnceWith('run-1');
        expect(vi.mocked(operations.deleteRunObservationIds).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(operations.deleteRun).mock.invocationCallOrder[0] ?? 0
        );
    });

    it('treats an old draft with no run as eligible workflow history', async () => {
        const operations = createOperations();

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-runs',
            planId: 'plan-draft',
        });

        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-steps',
            planId: 'plan-draft',
        });
    });

    it('rechecks protection before a destructive phase and leaves the plan untouched', async () => {
        const operations = createOperations({ hasProtectedRun: vi.fn(() => Promise.resolve(true)) });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
            scanCursor: 'next-plan',
        });

        expect(operations.loadBlueprintPlanChildIds).not.toHaveBeenCalled();
        expect(operations.deleteBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-select',
            scanCursor: 'next-plan',
        });
    });

    it('refuses to drain a plan that was not claimed obsolete', async () => {
        const operations = createOperations({
            loadPlanState: vi.fn(() => Promise.resolve({ status: 'approved', updatedAt: oldRunUpdatedAt })),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
            scanCursor: 'next-plan',
        });

        expect(operations.loadBlueprintPlanChildIds).not.toHaveBeenCalled();
        expect(operations.deleteBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-select',
            scanCursor: 'next-plan',
        });
    });

    it('uses the final child fence to restart the earliest remaining phase', async () => {
        const operations = createOperations({
            findRemainingPlanPhase: vi.fn(() => Promise.resolve('blueprint-plan-steps' as const)),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan',
            planId: 'plan-old',
        });

        expect(operations.deletePlan).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
        });
    });

    it('keeps child deletion bounded and repeats the same phase while another row exists', async () => {
        const ids = Array.from(
            { length: historicalRetentionBatchSize + 1 },
            (_, index) => `plan-step-${String(index)}`
        );
        const operations = createOperations({
            loadBlueprintPlanChildIds: vi.fn(() => Promise.resolve(ids)),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
        });

        expect(operations.deleteBlueprintChildIds).toHaveBeenCalledWith(
            'blueprint-plan-steps',
            ids.slice(0, historicalRetentionBatchSize)
        );
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-plan-steps',
            planId: 'plan-old',
        });
    });
});

function createOperations(
    overrides: Partial<HistoricalRetentionOperations> = {}
): HistoricalRetentionOperations & Record<keyof HistoricalRetentionOperations, ReturnType<typeof vi.fn>> {
    const operations = {
        claimExpiredPlan: vi.fn(() => Promise.resolve(true)),
        deleteAuditEventIds: vi.fn(() => Promise.resolve()),
        deleteBlueprintChildIds: vi.fn(() => Promise.resolve()),
        deleteRunObservationIds: vi.fn(() => Promise.resolve()),
        deleteRun: vi.fn(() => Promise.resolve()),
        deletePlan: vi.fn(() => Promise.resolve()),
        findRemainingPlanPhase: vi.fn(() => Promise.resolve(null)),
        hasProtectedRun: vi.fn(() => Promise.resolve(false)),
        loadRunStepAttemptIds: vi.fn(() => Promise.resolve([])),
        loadRunObservationIds: vi.fn(() => Promise.resolve([])),
        loadBlueprintPlanChildIds: vi.fn(() => Promise.resolve([])),
        loadExpiredAuditEventIds: vi.fn(() => Promise.resolve([])),
        loadFirstRun: vi.fn(() => Promise.resolve(null)),
        loadNextExpiredPlan: vi.fn(() => Promise.resolve({ continueCursor: 'end', isDone: true, planId: null })),
        loadPlanState: vi.fn(() => Promise.resolve({ status: 'obsolete', updatedAt: oldRunUpdatedAt })),
        schedule: vi.fn(() => Promise.resolve()),
        ...overrides,
    };
    return operations as HistoricalRetentionOperations &
        Record<keyof HistoricalRetentionOperations, ReturnType<typeof vi.fn>>;
}
