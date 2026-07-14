import { describe, expect, it } from 'vitest';

import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import {
    canStartNewBlueprintDeployment,
    getDashboardStructureDeployStage,
} from './dashboard-structure-deploy-stage.js';

describe('getDashboardStructureDeployStage', () => {
    it('treats an execution as authoritative over a stale plan status', () => {
        const run = {
            status: 'approved',
            execution: {
                id: 'execution-1',
                protocolVersion: 1,
                status: 'queued',
                phase: 'queued',
                completedActions: 0,
                failedActions: 0,
                totalActions: 4,
                createdAt: '2026-07-12T10:00:00.000Z',
                updatedAt: '2026-07-12T10:00:00.000Z',
            },
        } as DashboardStructureImportRun;

        expect(getDashboardStructureDeployStage(run)).toBe(3);
    });

    it.each(['queued', 'running', 'paused', 'partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const)(
        'does not allow a new source while an execution is %s',
        (status) => {
            const run = {
                execution: { status },
            } as DashboardStructureImportRun;

            expect(canStartNewBlueprintDeployment(run)).toBe(false);
        }
    );

    it.each(['succeeded', 'failed_before_mutation', 'cancelled'] as const)(
        'allows a new source after an execution is %s',
        (status) => {
            const run = {
                execution: { status },
            } as DashboardStructureImportRun;

            expect(canStartNewBlueprintDeployment(run)).toBe(true);
        }
    );
});
