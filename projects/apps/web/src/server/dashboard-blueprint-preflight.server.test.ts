import { describe, expect, it } from 'vitest';

import { blueprintPlanDigest } from './dashboard-blueprint-apply-plan.js';
import { diffDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { checkDashboardBlueprintPlanProjection } from './dashboard-blueprint-preflight.server.js';

describe('Server Blueprint projection preflight', () => {
    it('accepts the exact reviewed plan projection', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardBlueprintSnapshot(snapshot, snapshot, { policy: 'synchronize' });

        expect(
            checkDashboardBlueprintPlanProjection(snapshot, {
                knownTargetKinds: plan.knownTargetKinds,
                planVersion: 3,
                policy: 'synchronize',
                requestedGuildId: snapshot.guildId,
                requestedSnapshot: snapshot,
                planDigest: blueprintPlanDigest(plan.fingerprintInput),
                sourceTargetMap: plan.sourceTargetMap,
            })
        ).toEqual({ status: 'current' });
    });

    it('fails closed instead of silently discarding malformed or unauthorized reference mappings', () => {
        const snapshot = createSnapshot();
        const plan = diffDashboardBlueprintSnapshot(snapshot, snapshot, { policy: 'synchronize' });
        const persisted = {
            knownTargetKinds: plan.knownTargetKinds,
            planVersion: 3,
            policy: 'synchronize',
            requestedGuildId: snapshot.guildId,
            requestedSnapshot: snapshot,
            planDigest: blueprintPlanDigest(plan.fingerprintInput),
        };

        expect(
            checkDashboardBlueprintPlanProjection(snapshot, {
                ...persisted,
                sourceTargetMap: { unexpected: 42 },
            })
        ).toMatchObject({ status: 'stale' });
        expect(
            checkDashboardBlueprintPlanProjection(snapshot, {
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
        const plan = diffDashboardBlueprintSnapshot(current, requested, { policy: 'merge' });

        expect(
            checkDashboardBlueprintPlanProjection(current, {
                knownTargetKinds: plan.knownTargetKinds,
                planVersion: 3,
                policy: 'merge',
                requestedGuildId: requested.guildId,
                requestedSnapshot: requested,
                planDigest: blueprintPlanDigest(plan.fingerprintInput),
                sourceTargetMap: {
                    'source-a': 'target-b',
                    'source-b': 'target-a',
                },
            })
        ).toMatchObject({ status: 'stale' });
    });

    it('fails closed for an incomplete persisted plan', () => {
        expect(checkDashboardBlueprintPlanProjection(createSnapshot(), {})).toMatchObject({ status: 'stale' });
    });
});

function createSnapshot(overrides: Partial<DashboardBlueprintSnapshot> = {}): DashboardBlueprintSnapshot {
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

function createCategory(id: string, name: string, position: number): DashboardBlueprintSnapshot['categories'][number] {
    return { id, name, type: 4, parentId: null, position, permissionOverwrites: [] };
}
