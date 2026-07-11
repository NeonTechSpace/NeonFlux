import { describe, expect, it } from 'vitest';

import { structurePlanDigest } from './dashboard-structure-apply-plan.js';
import { diffDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { checkDashboardStructurePlanProjection } from './dashboard-structure-preflight.server.js';

describe('Server Blueprint projection preflight', () => {
    it('accepts the exact reviewed plan projection', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardStructureSnapshot(snapshot, snapshot, { policy: 'synchronize' });

        expect(
            checkDashboardStructurePlanProjection(snapshot, {
                knownTargetKinds: plan.knownTargetKinds,
                planVersion: 3,
                policy: 'synchronize',
                requestedGuildId: snapshot.guildId,
                requestedSnapshot: snapshot,
                planDigest: structurePlanDigest(plan.fingerprintInput),
                sourceTargetMap: plan.sourceTargetMap,
            })
        ).toEqual({ status: 'current' });
    });

    it('fails closed instead of silently discarding malformed or unauthorized reference mappings', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardStructureSnapshot(snapshot, snapshot, { policy: 'synchronize' });
        const persisted = {
            knownTargetKinds: plan.knownTargetKinds,
            planVersion: 3,
            policy: 'synchronize',
            requestedGuildId: snapshot.guildId,
            requestedSnapshot: snapshot,
            planDigest: structurePlanDigest(plan.fingerprintInput),
        };

        expect(
            checkDashboardStructurePlanProjection(snapshot, {
                ...persisted,
                sourceTargetMap: { unexpected: 42 },
            })
        ).toMatchObject({ status: 'stale' });
        expect(
            checkDashboardStructurePlanProjection(snapshot, {
                ...persisted,
                sourceTargetMap: { unexpected: 'not-a-known-target' },
            })
        ).toMatchObject({ status: 'stale' });
    });

    it('rejects a well-formed reference map that no longer matches the reviewed projection', () => {
        const current = createSnapshot({
            categories: [createCategory('target-a', 'A', 0), createCategory('target-b', 'B', 1)],
        });
        const requested = createSnapshot({
            guildId: 'source-guild',
            categories: [createCategory('source-a', 'A', 0), createCategory('source-b', 'B', 1)],
        });
        const plan = diffDashboardStructureSnapshot(current, requested, { policy: 'merge' });

        expect(
            checkDashboardStructurePlanProjection(current, {
                knownTargetKinds: plan.knownTargetKinds,
                planVersion: 3,
                policy: 'merge',
                requestedGuildId: requested.guildId,
                requestedSnapshot: requested,
                planDigest: structurePlanDigest(plan.fingerprintInput),
                sourceTargetMap: {
                    'source-a': 'target-b',
                    'source-b': 'target-a',
                },
            })
        ).toMatchObject({ status: 'stale' });
    });

    it('fails closed for an incomplete persisted plan', () => {
        expect(checkDashboardStructurePlanProjection(createSnapshot(), {})).toMatchObject({ status: 'stale' });
    });
});

function createSnapshot(overrides: Partial<DashboardStructureSnapshot> = {}): DashboardStructureSnapshot {
    return {
        version: 1,
        guildId: 'guild-1',
        guildName: 'Guild',
        roles: [],
        categories: [],
        channels: [],
        ...overrides,
    };
}

function createCategory(id: string, name: string, position: number): DashboardStructureSnapshot['categories'][number] {
    return { id, name, type: 4, parentId: null, position, permissionOverwrites: [] };
}
