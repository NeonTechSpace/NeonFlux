import { describe, expect, it } from 'vitest';

import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { getDashboardStructureDeployStage } from './dashboard-structure-deploy-stage.js';

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

    it.each([
        [undefined, 1],
        ['review_ready', 2],
        ['approved', 3],
        ['failed', 1],
    ] as const)('maps %s without an execution to stage %s', (status, expected) => {
        const run = status ? ({ status } as DashboardStructureImportRun) : undefined;

        expect(getDashboardStructureDeployStage(run)).toBe(expected);
    });
});
