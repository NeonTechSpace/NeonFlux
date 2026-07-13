import { describe, expect, it } from 'vitest';

import {
    dashboardCategories,
    dashboardNavigationEntries,
    getDashboardCategorySubNavigation,
    getDashboardNavigationJob,
    getDashboardNavigationEntry,
    getRequiredDefaultDashboardSubNavigationTo,
} from './dashboard-categories.js';

describe('dashboard categories', () => {
    it('keeps subnavigation alphabetical inside each category', () => {
        for (const category of dashboardCategories) {
            const labels = getDashboardCategorySubNavigation(category.id).map((item) => item.label);

            expect(labels).toStrictEqual([...labels].sort((left, right) => left.localeCompare(right)));
        }
    });

    it('shows direct workspaces and keeps multi-feature jobs stable as groups', () => {
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
            defaultSubNavigationTo: '/dashboard/$guildId/messaging/message-builder',
            linkTo: '/dashboard/$guildId/messaging/message-builder',
        });
        expect(messaging.subNavigation.map((item) => item.id)).toStrictEqual(['message-builder']);
        expect(() => getDashboardNavigationEntry('moderation')).toThrow('Unknown dashboard navigation entry');
    });

    it('exposes only implemented routes in navigation', () => {
        expect(
            dashboardNavigationEntries
                .flatMap((entry) => entry.subNavigation)
                .every((item) => item.status === 'implemented')
        ).toBe(true);
    });

    it('gives implemented task destinations full workspaces and distinct icons', () => {
        const implementedItems = dashboardNavigationEntries.flatMap((entry) => entry.subNavigation);
        const widths = Object.fromEntries(implementedItems.map((item) => [item.id, item.pageWidth]));

        expect(widths).toMatchObject({
            'reaction-roles': 'full',
            'command-prefix': 'full',
        });

        for (const item of implementedItems) {
            expect(item.icon).not.toBe(getDashboardNavigationJob(item.navigationJobId).icon);
        }
    });

    it('redirects legacy category indexes to available capabilities when possible', () => {
        expect(getRequiredDefaultDashboardSubNavigationTo('messaging')).toBe(
            '/dashboard/$guildId/messaging/message-builder'
        );
        expect(getRequiredDefaultDashboardSubNavigationTo('access')).toBe('/dashboard/$guildId/access/reaction-roles');
        expect(getRequiredDefaultDashboardSubNavigationTo('general')).toBe(
            '/dashboard/$guildId/general/command-prefix'
        );
        expect(getRequiredDefaultDashboardSubNavigationTo('events')).toBe('/dashboard/$guildId/events/audit-events');
    });
});
