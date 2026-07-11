import { describe, expect, it } from 'vitest';

import {
    formatDashboardStructureExecutionPhase,
    formatDashboardStructureExecutionState,
    getDashboardStructureDeleteApprovalText,
} from '../server/dashboard-structure-contracts.js';

describe('Server Blueprint panel contracts', () => {
    it('binds destructive confirmation to run, count, and delete manifest', () => {
        expect(getDashboardStructureDeleteApprovalText('run-7', 12, 'abcdef0123456789')).toBe(
            'DELETE run-7 12 abcdef012345'
        );
    });

    it('describes rate-limit waits and final verification instead of presenting them as queued', () => {
        const queued = formatDashboardStructureExecutionPhase('queued');
        const waiting = formatDashboardStructureExecutionPhase('waiting_rate_limit');
        const verifying = formatDashboardStructureExecutionPhase('verifying');

        expect(waiting).toMatch(/rate limit/iu);
        expect(verifying).toMatch(/verif/iu);
        expect(waiting).not.toBe(queued);
        expect(verifying).not.toBe(queued);
    });

    it('keeps a pause request visible while the current provider phase finishes', () => {
        expect(
            formatDashboardStructureExecutionState({
                id: 'execution-1',
                protocolVersion: 1,
                status: 'pause_requested',
                phase: 'update',
                completedActions: 1,
                failedActions: 0,
                totalActions: 3,
                createdAt: '2026-07-12T12:00:00.000Z',
                updatedAt: '2026-07-12T12:01:00.000Z',
            })
        ).toMatch(/pause requested/iu);
    });
});
