import {
    listBlueprintPlanSummariesByGuildId,
    listLatestBlueprintPlanPreflightSummaries,
    listLatestBlueprintRunSummaries,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import { loadDashboardBlueprintRuns } from './dashboard-blueprint-runs.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    listBlueprintPlanSummariesByGuildId: vi.fn(),
    listLatestBlueprintPlanPreflightSummaries: vi.fn(),
    listLatestBlueprintRunSummaries: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-blueprint-context.server.js', () => ({ loadAuthorizedBlueprintContext: vi.fn() }));

const now = new Date('2026-07-15T10:00:00.000Z');

describe('Blueprint History summary I/O boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedBlueprintContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1', name: 'Guild One' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
        vi.mocked(listBlueprintPlanSummariesByGuildId).mockResolvedValue(ok([createPlanSummary()] as never));
        vi.mocked(listLatestBlueprintPlanPreflightSummaries).mockResolvedValue(ok({ 'plan-1': null }));
        vi.mocked(listLatestBlueprintRunSummaries).mockResolvedValue(ok({ 'plan-1': null }));
    });

    it('composes History from exactly the three bounded summary operations', async () => {
        const result = await loadDashboardBlueprintRuns(new Request('http://localhost'), 'guild-1');

        expect(result).toMatchObject({ type: 'runs', plans: [{ id: 'plan-1', planStepCount: 474 }] });
        expect(listBlueprintPlanSummariesByGuildId).toHaveBeenCalledOnce();
        expect(listLatestBlueprintPlanPreflightSummaries).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                planIds: ['plan-1'],
            }
        );
        expect(listLatestBlueprintRunSummaries).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                planIds: ['plan-1'],
            }
        );
    });
});

function createPlanSummary() {
    return {
        id: 'plan-1',
        guildId: 'guild-1',
        sourceBackupId: null,
        status: 'approved',
        policy: 'synchronize',
        planVersion: 4,
        summary: { creates: 474, updates: 0, deletes: 0, roles: 474, categories: 0, channels: 0 },
        decisionSummary: {
            noOp: 0,
            create: 474,
            update: 0,
            delete: 0,
            protectedRetained: 0,
            protectedOmitted: 0,
            unmanagedRetained: 0,
            blockedAmbiguous: 0,
            blockedUnsupported: 0,
        },
        blockerCount: 0,
        requestedSnapshotDigest: 'a'.repeat(64),
        projectedSnapshotDigest: 'b'.repeat(64),
        authorityVersion: 1,
        authorityDigest: 'c'.repeat(64),
        executionAuthorityVersion: 1,
        executionAuthorityDigest: 'd'.repeat(64),
        stepCount: 474,
        stepLedgerDigest: 'e'.repeat(64),
        decisionCount: 474,
        decisionLedgerDigest: 'f'.repeat(64),
        deleteStepCount: 0,
        deleteSetDigest: null,
        planDigest: '1'.repeat(64),
        createdByUserId: 'user-1',
        createdAt: now,
        updatedAt: now,
    };
}
