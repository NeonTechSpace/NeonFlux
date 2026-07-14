import { describe, expect, it } from 'vitest';

import {
    dashboardLiveAreasForBotActionFeature,
    normalizeDashboardLiveAreas,
    blueprintRunLiveAreas,
} from './dashboard_live_model.js';

describe('dashboard live event routing', () => {
    it('normalizes untrusted areas while keeping audit and execution invalidation scoped', () => {
        expect(
            normalizeDashboardLiveAreas([' commands ', 'unknown', 'commands', 'blueprint_run', 'audit'])
        ).toStrictEqual(['commands', 'blueprint_run', 'audit']);
        expect(dashboardLiveAreasForBotActionFeature('settings')).toStrictEqual(['commands', 'audit']);
        expect(dashboardLiveAreasForBotActionFeature('unknown')).toStrictEqual(['audit']);
        expect(blueprintRunLiveAreas).toStrictEqual(['blueprint_run']);
        expect(blueprintRunLiveAreas).not.toContain('blueprint');
    });
});
