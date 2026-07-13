import { describe, expect, it } from 'vitest';

import {
    dashboardLiveAreasForBotActionFeature,
    normalizeDashboardLiveAreas,
    structureExecutionLiveAreas,
} from './dashboard_live_model.js';

describe('dashboard live event routing', () => {
    it('normalizes untrusted areas while keeping audit and execution invalidation scoped', () => {
        expect(
            normalizeDashboardLiveAreas([' commands ', 'unknown', 'commands', 'structure_execution', 'audit'])
        ).toStrictEqual(['commands', 'structure_execution', 'audit']);
        expect(dashboardLiveAreasForBotActionFeature('settings')).toStrictEqual(['commands', 'audit']);
        expect(dashboardLiveAreasForBotActionFeature('unknown')).toStrictEqual(['audit']);
        expect(structureExecutionLiveAreas).toStrictEqual(['structure_execution']);
        expect(structureExecutionLiveAreas).not.toContain('structure');
    });
});
