import { describe, expect, it } from 'vitest';

import {
    dashboardLiveAreasForBotActionFeature,
    normalizeDashboardLiveAreas,
    normalizeDashboardLiveGuildId,
    structureExecutionLiveAreas,
} from './dashboard_live_model.js';

describe('dashboard live model', () => {
    it('normalizes supported areas and drops unknown values', () => {
        expect(
            normalizeDashboardLiveAreas([' commands ', 'nope', 'commands', 'structure_execution', 'audit'])
        ).toStrictEqual(['commands', 'structure_execution', 'audit']);
    });

    it('maps audit features to visible dashboard areas plus audit', () => {
        expect(dashboardLiveAreasForBotActionFeature('settings')).toStrictEqual(['commands', 'audit']);
        expect(dashboardLiveAreasForBotActionFeature('import_export')).toStrictEqual([
            'import_export',
            'structure',
            'audit',
        ]);
        expect(dashboardLiveAreasForBotActionFeature('unknown')).toStrictEqual(['audit']);
    });

    it('trims live guild ids', () => {
        expect(normalizeDashboardLiveGuildId(' guild-1 ')).toBe('guild-1');
    });

    it('isolates execution progress from canonical structure invalidation', () => {
        expect(structureExecutionLiveAreas).toStrictEqual(['structure_execution']);
        expect(structureExecutionLiveAreas).not.toContain('structure');
    });
});
