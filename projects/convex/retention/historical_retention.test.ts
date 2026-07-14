import { describe, expect, it, vi } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordStructureImportAction } from '../structure/structure.js';
import { enqueueStructureImportExecution } from '../structure/structure_import_review.js';
import {
    deletableStructureExecutionStatuses,
    executeHistoricalRetentionBatch,
    historicalRetentionBatchSize,
    isDeletableStructureExecutionStatus,
    isProtectedStructureExecutionStatus,
    protectedStructureExecutionStatuses,
    type HistoricalRetentionOperations,
} from './historical_retention.js';

const now = '2026-07-14T12:00:00.000Z';
const cutoff = '2026-04-15T12:00:00.000Z';
const oldRunUpdatedAt = '2026-04-15T11:59:59.999Z';
type TestMutation = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

describe('historical retention', () => {
    it('partitions actual execution statuses into deletable and protected ownership', () => {
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

        expect(statuses.filter(isProtectedStructureExecutionStatus)).toStrictEqual([
            ...protectedStructureExecutionStatuses,
        ]);
        expect(statuses.filter(isDeletableStructureExecutionStatus)).toStrictEqual([
            ...deletableStructureExecutionStatuses,
        ]);
        expect(
            statuses.every(
                (status) => isProtectedStructureExecutionStatus(status) !== isDeletableStructureExecutionStatus(status)
            )
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
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({ cutoff, phase: 'blueprint-select' });
    });

    it('skips a protected run and continues from its page cursor', async () => {
        const operations = createOperations({
            claimExpiredRun: vi.fn(() => Promise.resolve(false)),
            loadNextExpiredRun: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-protected', isDone: false, runId: 'run-protected' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-select' });

        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-select',
            scanCursor: 'after-protected',
        });
        expect(operations.deleteRun).not.toHaveBeenCalled();
    });

    it('stops cleanly when the protected candidate is the final page', async () => {
        const operations = createOperations({
            claimExpiredRun: vi.fn(() => Promise.resolve(false)),
            loadNextExpiredRun: vi.fn(() =>
                Promise.resolve({ continueCursor: 'end', isDone: true, runId: 'run-protected' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-select' });

        expect(operations.schedule).not.toHaveBeenCalled();
    });

    it('carries the selector cursor across deletion of its current candidate', async () => {
        const operations = createOperations({
            findRemainingRunPhase: vi.fn(() => Promise.resolve(null)),
            loadNextExpiredRun: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-deleted', isDone: true, runId: 'run-old' })
            ),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-select' });
        expect(operations.schedule).toHaveBeenLastCalledWith({
            cutoff,
            phase: 'blueprint-executions',
            runId: 'run-old',
            scanCursor: 'after-deleted',
        });

        vi.mocked(operations.schedule).mockClear();
        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-run',
            runId: 'run-old',
            scanCursor: 'after-deleted',
        });

        expect(operations.deleteRun).toHaveBeenCalledExactlyOnceWith('run-old');
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-select',
            scanCursor: 'after-deleted',
        });
    });

    it('claims the run stale before scheduling its first child drain', async () => {
        let runStatus = 'approved';
        const operations = createOperations({
            claimExpiredRun: vi.fn(() => {
                runStatus = 'stale';
                return Promise.resolve(true);
            }),
            loadNextExpiredRun: vi.fn(() =>
                Promise.resolve({ continueCursor: 'after-claimed', isDone: false, runId: 'run-old' })
            ),
            loadRunState: vi.fn(() => Promise.resolve({ status: runStatus, updatedAt: oldRunUpdatedAt })),
        });

        await executeHistoricalRetentionBatch(operations, { cutoff, now, phase: 'blueprint-select' });

        expect(runStatus).toBe('stale');
        expect(vi.mocked(operations.claimExpiredRun).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(operations.schedule).mock.invocationCallOrder[0] ?? 0
        );
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-executions',
            runId: 'run-old',
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
                get: () => Promise.resolve({ _id: 'run-old', status: runStatus }),
            },
        };
        const enqueueHandler = (enqueueStructureImportExecution as unknown as TestMutation)._handler;
        const recordActionHandler = (recordStructureImportAction as unknown as TestMutation)._handler;
        try {
            await expect(
                enqueueHandler(claimedRunContext, {
                    now,
                    preflightDigest: 'digest',
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                    runId: 'run-old',
                })
            ).rejects.toThrow('structure-execution-plan-not-approved');
            await expect(
                recordActionHandler(claimedRunContext, {
                    actionType: 'create_channel',
                    runId: 'run-old',
                    sequence: 0,
                    targetType: 'channel',
                })
            ).rejects.toThrow('structure-import-action-ledger-immutable');
        } finally {
            if (previousIssuer === undefined) delete process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER;
            else process.env.NEONFLUX_WEB_AUTH_JWT_ISSUER = previousIssuer;
        }

        vi.mocked(operations.schedule).mockClear();
        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-actions',
            runId: 'run-old',
            scanCursor: 'after-claimed',
        });

        expect(operations.loadBlueprintChildIds).toHaveBeenCalled();
    });

    it('deletes attempts before their terminal execution and then repeats that phase', async () => {
        const operations = createOperations({
            loadAttemptIds: vi.fn(() => Promise.resolve(['attempt-1', 'attempt-2'])),
            loadFirstExecution: vi.fn(() => Promise.resolve({ id: 'execution-1', status: 'succeeded' })),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-executions',
            runId: 'run-old',
        });

        expect(operations.deleteBlueprintChildIds).toHaveBeenCalledWith('blueprint-attempts', [
            'attempt-1',
            'attempt-2',
        ]);
        expect(operations.deleteExecution).toHaveBeenCalledExactlyOnceWith('execution-1');
        expect(vi.mocked(operations.deleteBlueprintChildIds).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(operations.deleteExecution).mock.invocationCallOrder[0] ?? 0
        );
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-executions',
            runId: 'run-old',
        });
    });

    it('treats an old draft with no execution as eligible workflow history', async () => {
        const operations = createOperations();

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-executions',
            runId: 'run-draft',
        });

        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-actions',
            runId: 'run-draft',
        });
    });

    it('rechecks protection before a destructive phase and leaves the run untouched', async () => {
        const operations = createOperations({ hasProtectedExecution: vi.fn(() => Promise.resolve(true)) });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-actions',
            runId: 'run-old',
            scanCursor: 'next-run',
        });

        expect(operations.loadBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.deleteBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-select',
            scanCursor: 'next-run',
        });
    });

    it('refuses to drain a run that was not claimed stale', async () => {
        const operations = createOperations({
            loadRunState: vi.fn(() => Promise.resolve({ status: 'approved', updatedAt: oldRunUpdatedAt })),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-actions',
            runId: 'run-old',
            scanCursor: 'next-run',
        });

        expect(operations.loadBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.deleteBlueprintChildIds).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-select',
            scanCursor: 'next-run',
        });
    });

    it('uses the final child fence to restart the earliest remaining phase', async () => {
        const operations = createOperations({
            findRemainingRunPhase: vi.fn(() => Promise.resolve('blueprint-actions' as const)),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-run',
            runId: 'run-old',
        });

        expect(operations.deleteRun).not.toHaveBeenCalled();
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-actions',
            runId: 'run-old',
        });
    });

    it('keeps child deletion bounded and repeats the same phase while another row exists', async () => {
        const ids = Array.from({ length: historicalRetentionBatchSize + 1 }, (_, index) => `action-${String(index)}`);
        const operations = createOperations({
            loadBlueprintChildIds: vi.fn(() => Promise.resolve(ids)),
        });

        await executeHistoricalRetentionBatch(operations, {
            cutoff,
            now,
            phase: 'blueprint-actions',
            runId: 'run-old',
        });

        expect(operations.deleteBlueprintChildIds).toHaveBeenCalledWith(
            'blueprint-actions',
            ids.slice(0, historicalRetentionBatchSize)
        );
        expect(operations.schedule).toHaveBeenCalledExactlyOnceWith({
            cutoff,
            phase: 'blueprint-actions',
            runId: 'run-old',
        });
    });
});

function createOperations(
    overrides: Partial<HistoricalRetentionOperations> = {}
): HistoricalRetentionOperations & Record<keyof HistoricalRetentionOperations, ReturnType<typeof vi.fn>> {
    const operations = {
        claimExpiredRun: vi.fn(() => Promise.resolve(true)),
        deleteAuditEventIds: vi.fn(() => Promise.resolve()),
        deleteBlueprintChildIds: vi.fn(() => Promise.resolve()),
        deleteExecution: vi.fn(() => Promise.resolve()),
        deleteRun: vi.fn(() => Promise.resolve()),
        findRemainingRunPhase: vi.fn(() => Promise.resolve(null)),
        hasProtectedExecution: vi.fn(() => Promise.resolve(false)),
        loadAttemptIds: vi.fn(() => Promise.resolve([])),
        loadBlueprintChildIds: vi.fn(() => Promise.resolve([])),
        loadExpiredAuditEventIds: vi.fn(() => Promise.resolve([])),
        loadFirstExecution: vi.fn(() => Promise.resolve(null)),
        loadNextExpiredRun: vi.fn(() => Promise.resolve({ continueCursor: 'end', isDone: true, runId: null })),
        loadRunState: vi.fn(() => Promise.resolve({ status: 'stale', updatedAt: oldRunUpdatedAt })),
        schedule: vi.fn(() => Promise.resolve()),
        ...overrides,
    };
    return operations as HistoricalRetentionOperations &
        Record<keyof HistoricalRetentionOperations, ReturnType<typeof vi.fn>>;
}
