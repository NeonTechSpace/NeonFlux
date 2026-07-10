import { describe, expect, it, vi } from 'vitest';

import {
    completeDashboardStructureApplyAttempt,
    createDashboardStructureApplyAttempt,
    isDashboardStructureApplyAttemptExpired,
    readDashboardStructureApplyAttempt,
    recoverDashboardStructureApplyAttempt,
    renewDashboardStructureApplyAttempt,
    runWithDashboardStructureApplyHeartbeat,
} from './dashboard-structure-apply-attempt.js';

describe('dashboard structure apply attempts', () => {
    const startedAt = new Date('2026-07-10T00:00:00.000Z');

    it('creates renewable leases and exposes recovery only after expiry', () => {
        const attempt = createDashboardStructureApplyAttempt({
            attemptId: 'attempt-1',
            leaseOwner: 'worker-1',
            now: startedAt,
            roleOrderRequired: true,
        });

        expect(readDashboardStructureApplyAttempt({ applyAttempt: attempt })).toStrictEqual(attempt);
        expect(
            isDashboardStructureApplyAttemptExpired({ applyAttempt: attempt }, new Date('2026-07-10T00:14:59Z'))
        ).toBe(false);
        expect(
            isDashboardStructureApplyAttemptExpired({ applyAttempt: attempt }, new Date('2026-07-10T00:15:00Z'))
        ).toBe(true);

        const renewed = renewDashboardStructureApplyAttempt(attempt, new Date('2026-07-10T00:04:00Z'));
        expect(renewed.leaseExpiresAt).toBe('2026-07-10T00:19:00.000Z');
        expect(
            isDashboardStructureApplyAttemptExpired({ applyAttempt: renewed }, new Date('2026-07-10T00:05:00Z'))
        ).toBe(false);
    });

    it('persists role-order outcomes and unknown recovery outcomes', () => {
        const attempt = createDashboardStructureApplyAttempt({
            attemptId: 'attempt-1',
            leaseOwner: 'worker-1',
            now: startedAt,
            roleOrderRequired: true,
        });
        const completed = completeDashboardStructureApplyAttempt(attempt, {
            now: new Date('2026-07-10T00:01:00Z'),
            outcome: 'failed',
            roleOrderErrorType: 'permission-denied',
            roleOrderStatus: 'failed',
        });
        const recovered = recoverDashboardStructureApplyAttempt(attempt, new Date('2026-07-10T00:06:00Z'));

        expect(completed).toMatchObject({
            outcome: 'failed',
            roleOrder: { errorType: 'permission-denied', status: 'failed' },
        });
        expect(recovered).toMatchObject({
            outcome: 'unknown',
            recoveredAt: '2026-07-10T00:06:00.000Z',
        });
    });

    it('heartbeats while work is active and records bounded renewal failure', async () => {
        vi.useFakeTimers();
        try {
            let finishOperation: ((value: string) => void) | undefined;
            const renew = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined);
            const operation = new Promise<string>((resolve) => {
                finishOperation = resolve;
            });
            const resultPromise = runWithDashboardStructureApplyHeartbeat({
                intervalMs: 100,
                operation: () => operation,
                renew,
            });

            await vi.advanceTimersByTimeAsync(200);
            finishOperation?.('done');
            const result = await resultPromise;

            expect(renew).toHaveBeenCalledTimes(2);
            expect(result).toStrictEqual({ heartbeatFailed: true, value: 'done' });
        } finally {
            vi.useRealTimers();
        }
    });
});
