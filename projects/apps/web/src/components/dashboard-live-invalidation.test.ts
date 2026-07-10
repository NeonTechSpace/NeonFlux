import { describe, expect, it } from 'vitest';

import {
    countDashboardLiveInvalidationDestinations,
    dashboardLiveInvalidationDestination,
} from './dashboard-live-invalidation.js';

describe('dashboard live invalidation destinations', () => {
    it('deduplicates simultaneous terminal structure signals into one canonical workspace refresh', () => {
        expect(countDashboardLiveInvalidationDestinations(['structure', 'import_export'])).toBe(1);
        expect(dashboardLiveInvalidationDestination('structure')).toBe('structure-settings');
    });

    it('keeps execution checkpoints on the lightweight progress destination', () => {
        expect(dashboardLiveInvalidationDestination('structure_execution')).toBe('structure-execution-progress');
        expect(countDashboardLiveInvalidationDestinations(['structure_execution', 'structure'])).toBe(2);
    });
});
