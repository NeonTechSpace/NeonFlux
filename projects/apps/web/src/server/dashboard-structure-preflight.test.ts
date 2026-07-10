import { describe, expect, it } from 'vitest';

import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import {
    isDashboardStructurePreflightReady,
    preflightDashboardStructureImportPlan,
} from './dashboard-structure-preflight.js';

describe('Server Blueprint v2 action preflight', () => {
    it('reports an empty approved plan as ready', () => {
        expect(preflightDashboardStructureImportPlan(createSnapshot(), [], { policy: 'synchronize' }).summary).toEqual({
            total: 0,
            ready: 0,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
    });

    it('fails closed for an invalid planned action', () => {
        const report = preflightDashboardStructureImportPlan(
            createSnapshot(),
            [{ id: 'action-1', actionType: 'teleport', targetType: 'channel', targetId: 'channel-1', details: {} }],
            { policy: 'merge' }
        );
        expect(report.summary.invalidPlan).toBe(1);
        expect(report.actions[0]?.status).toBe('invalid-plan');
    });

    it('treats a delete-only safety check as ready for separate destructive approval', () => {
        expect(
            isDashboardStructurePreflightReady({
                summary: {
                    total: 1,
                    ready: 0,
                    stale: 0,
                    mappingRequired: 0,
                    destructiveApprovalRequired: 1,
                    unsupported: 0,
                    invalidPlan: 0,
                },
                actions: [],
            })
        ).toBe(true);
    });
});

function createSnapshot(): DashboardStructureSnapshot {
    return { version: 1, guildId: 'guild-1', guildName: 'Guild', roles: [], categories: [], channels: [] };
}
