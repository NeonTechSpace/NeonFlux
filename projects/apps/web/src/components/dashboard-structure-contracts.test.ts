import { describe, expect, it } from 'vitest';

import {
    formatDashboardStructureExecutionPhase,
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
});
