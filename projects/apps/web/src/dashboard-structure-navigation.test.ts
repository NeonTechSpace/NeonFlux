import { describe, expect, it } from 'vitest';

import { dashboardStructureNavigationItems, getDefaultDashboardStructureTo } from './dashboard-structure-navigation.js';

describe('dashboard structure navigation', () => {
    it('keeps the Blueprint workspace routes focused and ordered', () => {
        expect(dashboardStructureNavigationItems).toStrictEqual([
            {
                id: 'current',
                label: 'Current',
                to: '/dashboard/$guildId/structure/current',
            },
            {
                id: 'backups',
                label: 'Backups',
                to: '/dashboard/$guildId/structure/backups',
            },
            {
                id: 'compare',
                label: 'Compare',
                to: '/dashboard/$guildId/structure/compare',
            },
            {
                id: 'deploy',
                label: 'Deploy',
                to: '/dashboard/$guildId/structure/deploy',
            },
            {
                id: 'runs',
                label: 'Runs',
                to: '/dashboard/$guildId/structure/runs',
            },
        ]);
        expect(getDefaultDashboardStructureTo()).toBe('/dashboard/$guildId/structure/current');
    });
});
