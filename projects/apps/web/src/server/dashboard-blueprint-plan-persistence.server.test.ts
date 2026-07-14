import { describe, expect, it } from 'vitest';

import { createDashboardBlueprintPlanDigests } from './dashboard-blueprint-plan-persistence.server.js';

describe('Server Blueprint persisted plan authority', () => {
    it('omits a delete manifest when a plan has no deletes', () => {
        const result = createDashboardBlueprintPlanDigests(
            { fingerprintInput: { version: 3 }, steps: [] } as never,
            { version: 1, roles: [], categories: [], channels: [] } as never
        );

        expect(result.deleteStepCount).toBe(0);
        expect(result.deleteSetDigest).toBeNull();
        expect(result.planDigest).toHaveLength(64);
    });

    it('binds a deterministic digest and count to the exact delete manifest', () => {
        const deleteActions = [
            { actionType: 'delete', targetType: 'role', targetId: 'role-1' },
            { actionType: 'delete', targetType: 'channel', targetId: 'channel-1' },
        ];
        const plan = createPlan(deleteActions);
        const snapshot = { version: 1, roles: [], categories: [], channels: [] } as never;

        const first = createDashboardBlueprintPlanDigests(plan, snapshot);
        const second = createDashboardBlueprintPlanDigests(plan, snapshot);
        const reordered = createDashboardBlueprintPlanDigests(createPlan([...deleteActions].reverse()), snapshot);
        const changed = createDashboardBlueprintPlanDigests(
            createPlan(
                deleteActions.map((action) =>
                    action.targetId === 'role-1' ? { ...action, targetId: 'role-2' } : action
                )
            ),
            snapshot
        );
        expect(first).toEqual(second);
        expect(first.deleteStepCount).toBe(2);
        expect(first.deleteSetDigest).toHaveLength(64);
        expect(reordered.deleteSetDigest).toBe(first.deleteSetDigest);
        expect(changed.deleteSetDigest).not.toBe(first.deleteSetDigest);
    });
});

function createPlan(steps: Array<{ actionType: string; targetType: string; targetId: string }>) {
    return {
        fingerprintInput: { version: 3, policy: 'rebuild', steps },
        steps,
    } as never;
}
