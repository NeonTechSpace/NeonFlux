import { describe, expect, it } from 'vitest';

import {
    formatDashboardBlueprintRunPhase,
    formatDashboardBlueprintRunState,
} from '../server/dashboard-blueprint-contracts.js';

describe('Server Blueprint panel contracts', () => {
    it('describes rate-limit waits and final verification instead of presenting them as queued', () => {
        const queued = formatDashboardBlueprintRunPhase('queued');
        const waiting = formatDashboardBlueprintRunPhase('waiting_rate_limit');
        const verifying = formatDashboardBlueprintRunPhase('verifying');

        expect(waiting).toMatch(/rate limit/iu);
        expect(verifying).toMatch(/verif/iu);
        expect(waiting).not.toBe(queued);
        expect(verifying).not.toBe(queued);
    });

    it('keeps a pause request visible while the current provider phase finishes', () => {
        expect(
            formatDashboardBlueprintRunState({
                id: 'run-1',
                protocolVersion: 1,
                status: 'pause_requested',
                phase: 'update',
                completedSteps: 1,
                failedSteps: 0,
                totalSteps: 3,
                createdAt: '2026-07-12T12:00:00.000Z',
                updatedAt: '2026-07-12T12:01:00.000Z',
            })
        ).toMatch(/pause requested/iu);
    });
});
