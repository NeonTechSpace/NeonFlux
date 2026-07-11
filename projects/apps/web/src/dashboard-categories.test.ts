import { describe, expect, it } from 'vitest';

import {
    dashboardCategories,
    getDashboardCategorySubNavigation,
    getDashboardNavigationEntry,
} from './dashboard-categories.js';

describe('dashboard categories', () => {
    it('keeps subnavigation alphabetical inside each category', () => {
        for (const category of dashboardCategories) {
            const labels = getDashboardCategorySubNavigation(category.id).map((item) => item.label);

            expect(labels).toStrictEqual([...labels].sort((left, right) => left.localeCompare(right)));
        }
    });

    it('links standalone categories directly and exposes multi-page categories as groups', () => {
        expect(getDashboardNavigationEntry('overview')).toMatchObject({
            type: 'direct',
            linkTo: '/dashboard/$guildId',
            subNavigation: [],
        });
        expect(getDashboardNavigationEntry('structure')).toMatchObject({
            type: 'direct',
            linkTo: '/dashboard/$guildId/structure',
            subNavigation: [],
        });

        const messaging = getDashboardNavigationEntry('messaging');

        expect(messaging).toMatchObject({
            type: 'group',
            defaultSubNavigationTo: '/dashboard/$guildId/messaging/bluesky',
            linkTo: '/dashboard/$guildId/messaging/bluesky',
        });
        expect(messaging.subNavigation.length).toBeGreaterThan(1);
    });
});
