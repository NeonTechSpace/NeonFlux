import { describe, expect, it } from 'vitest';

import { diffDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { createDashboardBlueprintPlanAuthority } from './dashboard-blueprint-plan-persistence.server.js';

describe('Server Blueprint v4 authority construction', () => {
    it('separates immutable snapshots and reference authority from canonical ledgers', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardBlueprintSnapshot(snapshot, snapshot, { policy: 'synchronize' });
        const authority = createDashboardBlueprintPlanAuthority(plan, snapshot, {
            source: 'dashboard-json',
            requestedSnapshotStoredAt: '2026-07-15T10:00:00.000Z',
        });

        expect(authority).toMatchObject({
            requestedSnapshot: snapshot,
            projectedSnapshot: plan.projectedSnapshot,
            referenceAuthority: {
                sourceTargetMap: plan.sourceTargetMap,
                knownTargetKinds: plan.knownTargetKinds,
            },
            provenance: { source: 'dashboard-json' },
        });
        expect(authority).not.toHaveProperty('steps');
        expect(authority).not.toHaveProperty('decisions');
        expect(authority).not.toHaveProperty('fingerprintInput');
    });
});

function createSnapshot(): DashboardBlueprintSnapshot {
    return {
        version: 1,
        guildId: 'guild-1',
        guildName: 'Guild',
        roles: [],
        categories: [],
        channels: [],
    };
}
