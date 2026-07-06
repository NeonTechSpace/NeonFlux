import { describe, expect, it } from 'vitest';

import {
    dashboardCategories,
    getDashboardCategorySubNavigation,
    getDefaultDashboardSubNavigationTo,
} from './dashboard-categories.js';

describe('dashboard categories', () => {
    it('keeps main categories ordered by product priority', () => {
        expect(dashboardCategories.map((category) => category.id)).toStrictEqual([
            'overview',
            'messaging',
            'moderation',
            'access',
            'community',
            'insights',
            'general',
            'events',
            'structure',
            'system',
        ]);
    });

    it('keeps subnavigation alphabetical inside each category', () => {
        for (const category of dashboardCategories) {
            const labels = getDashboardCategorySubNavigation(category.id).map((item) => item.label);

            expect(labels).toStrictEqual([...labels].sort((left, right) => left.localeCompare(right)));
        }
    });

    it('defaults every grouped category to its first subitem, even placeholders', () => {
        expect(getDefaultDashboardSubNavigationTo('messaging')).toBe('/dashboard/$guildId/messaging/bluesky');
        expect(getDefaultDashboardSubNavigationTo('moderation')).toBe('/dashboard/$guildId/moderation/automod');
        expect(getDefaultDashboardSubNavigationTo('access')).toBe('/dashboard/$guildId/access/autoroles');
        expect(getDefaultDashboardSubNavigationTo('community')).toBe('/dashboard/$guildId/community/giveaways');
        expect(getDefaultDashboardSubNavigationTo('insights')).toBe('/dashboard/$guildId/insights/growth-tracking');
        expect(getDefaultDashboardSubNavigationTo('general')).toBe('/dashboard/$guildId/general/bot-presence');
        expect(getDefaultDashboardSubNavigationTo('events')).toBe('/dashboard/$guildId/events/audit-events');
        expect(getDefaultDashboardSubNavigationTo('structure')).toBe('/dashboard/$guildId/structure/import-export');
        expect(getDefaultDashboardSubNavigationTo('system')).toBe('/dashboard/$guildId/system/bot-installation-sync');
    });

    it('marks only the approved dashboard subitems implemented', () => {
        const implementedItems = dashboardCategories.flatMap((category) =>
            getDashboardCategorySubNavigation(category.id)
                .filter((item) => item.implemented)
                .map((item) => `${category.id}.${item.id}`)
        );

        expect(implementedItems).toStrictEqual([
            'messaging.message-builder',
            'access.reaction-roles',
            'general.command-prefix',
            'events.audit-events',
            'structure.import-export',
        ]);
    });
});
