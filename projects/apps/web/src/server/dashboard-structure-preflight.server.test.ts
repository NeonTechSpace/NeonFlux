import { describe, expect, it } from 'vitest';

import { structurePlanDigest } from './dashboard-structure-apply-plan.js';
import { diffDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { checkDashboardStructurePlanProjection } from './dashboard-structure-preflight.server.js';

describe('Server Blueprint v2 projection preflight', () => {
    it('accepts the exact reviewed plan projection', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardStructureSnapshot(snapshot, snapshot, { policy: 'synchronize' });

        expect(
            checkDashboardStructurePlanProjection(snapshot, {
                planVersion: 2,
                policy: 'synchronize',
                requestedSnapshot: snapshot,
                planDigest: structurePlanDigest(plan.fingerprintInput),
            })
        ).toEqual({ status: 'current' });
    });

    it('fails closed for an incomplete persisted plan', () => {
        expect(checkDashboardStructurePlanProjection(createSnapshot(), {})).toMatchObject({ status: 'stale' });
    });
});

function createSnapshot(): DashboardStructureSnapshot {
    return {
        version: 1,
        guildId: 'guild-1',
        guildName: 'Guild',
        roles: [],
        categories: [],
        channels: [],
    };
}
