import { createBlueprintPlanIntegrityDigests, deriveBlueprintPlanExecutionAuthorityBody } from '@neonflux/blueprint';
import { describe, expect, it } from 'vitest';

import { diffDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { createDashboardBlueprintPlanAuthority } from './dashboard-blueprint-plan-persistence.server.js';
import { checkDashboardBlueprintPlanProjection } from './dashboard-blueprint-preflight.server.js';

const now = new Date('2026-07-15T10:00:00.000Z');

describe('Server Blueprint projection preflight', () => {
    it('accepts the exact reviewed v4 projection', async () => {
        const snapshot = createSnapshot();
        const { metadata, authority } = await createPersistedPlan(snapshot, snapshot, 'synchronize');

        await expect(checkDashboardBlueprintPlanProjection(snapshot, metadata, authority)).resolves.toEqual({
            status: 'current',
        });
    });

    it('rejects a live structure that no longer matches the sealed plan digest', async () => {
        const current = createSnapshot({ categories: [createCategory('target-a', 'A', 0)] });
        const requested = createSnapshot({
            guildId: 'source-guild',
            categories: [createCategory('source-a', 'A', 0)],
        });
        const { metadata, authority } = await createPersistedPlan(current, requested, 'merge');
        const changed = createSnapshot({ categories: [createCategory('target-a', 'Changed', 0)] });

        await expect(checkDashboardBlueprintPlanProjection(changed, metadata, authority)).resolves.toMatchObject({
            status: 'stale',
        });
    });
});

async function createPersistedPlan(
    current: DashboardBlueprintSnapshot,
    requested: DashboardBlueprintSnapshot,
    policy: 'merge' | 'synchronize' | 'rebuild'
) {
    const plan = diffDashboardBlueprintSnapshot(current, requested, { policy });
    const body = createDashboardBlueprintPlanAuthority(plan, requested, {
        source: 'dashboard-json',
        requestedSnapshotStoredAt: now.toISOString(),
    });
    const execution = deriveBlueprintPlanExecutionAuthorityBody(body);
    const integrity = await createBlueprintPlanIntegrityDigests({
        guildId: current.guildId!,
        policy,
        summary: plan.summary,
        authority: body,
        executionAuthority: execution,
        steps: plan.steps.map((step, sequence) => ({ sequence, step })),
        decisions: plan.decisions.map((decision, sequence) => ({ sequence, decision })),
    });
    const authority = {
        id: 'authority-1',
        planId: 'plan-1',
        guildId: current.guildId!,
        version: 1 as const,
        ...body,
        authorityDigest: integrity.authorityDigest,
        createdAt: now,
    };
    const metadata = {
        id: 'plan-1',
        guildId: current.guildId!,
        sourceBackupId: null,
        status: 'approved' as const,
        policy,
        planVersion: 4 as const,
        summary: plan.summary,
        decisionSummary: {
            noOp: 0,
            create: 0,
            update: 0,
            delete: 0,
            protectedRetained: 0,
            protectedOmitted: 0,
            unmanagedRetained: 0,
            blockedAmbiguous: 0,
            blockedUnsupported: 0,
        },
        blockerCount: plan.blockers.length,
        requestedSnapshotDigest: integrity.requestedSnapshotDigest,
        projectedSnapshotDigest: integrity.projectedSnapshotDigest,
        authorityVersion: 1 as const,
        authorityDigest: integrity.authorityDigest,
        executionAuthorityVersion: 1 as const,
        executionAuthorityDigest: integrity.executionAuthorityDigest,
        stepCount: integrity.stepCount,
        stepLedgerDigest: integrity.stepLedgerDigest,
        decisionCount: integrity.decisionCount,
        decisionLedgerDigest: integrity.decisionLedgerDigest,
        deleteStepCount: integrity.deleteStepCount,
        deleteSetDigest: integrity.deleteSetDigest,
        planDigest: integrity.planDigest,
        createdByUserId: 'user-1',
        createdAt: now,
        updatedAt: now,
    };
    return { metadata, authority };
}

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
