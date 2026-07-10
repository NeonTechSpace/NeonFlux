import { describe, expect, it } from 'vitest';

import { createDashboardStructurePlanDigests } from './dashboard-structure-plan-persistence.server.js';

describe('Server Blueprint v2 persisted plan authority', () => {
    it('omits a delete manifest when a plan has no deletes', () => {
        const result = createDashboardStructurePlanDigests(
            { fingerprintInput: { version: 2 }, actions: [] } as never,
            { version: 1, roles: [], categories: [], channels: [] } as never
        );

        expect(result.deleteActionCount).toBe(0);
        expect(result.deleteSetDigest).toBeNull();
        expect(result.planDigest).toHaveLength(64);
    });

    it('binds a deterministic digest and count to the exact delete manifest', () => {
        const plan = {
            fingerprintInput: { version: 2, policy: 'rebuild' },
            actions: [
                { actionType: 'delete', targetType: 'role', targetId: 'role-1' },
                { actionType: 'delete', targetType: 'channel', targetId: 'channel-1' },
            ],
        } as never;
        const snapshot = { version: 1, roles: [], categories: [], channels: [] } as never;

        const first = createDashboardStructurePlanDigests(plan, snapshot);
        const second = createDashboardStructurePlanDigests(plan, snapshot);
        expect(first).toEqual(second);
        expect(first.deleteActionCount).toBe(2);
        expect(first.deleteSetDigest).toHaveLength(64);
    });
});
