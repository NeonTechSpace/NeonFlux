import { describe, expect, it } from 'vitest';

import {
    dashboardCapabilities,
    dashboardCategories,
    dashboardNavigationEntries,
    getDashboardCategorySubNavigation,
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

    it('shows only available capabilities and collapses single-capability jobs to direct links', () => {
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
            type: 'direct',
            defaultSubNavigationTo: '/dashboard/$guildId/messaging/message-builder',
            linkTo: '/dashboard/$guildId/messaging/message-builder',
        });
        expect(messaging.subNavigation.map((item) => item.id)).toStrictEqual(['message-builder']);
        expect(() => getDashboardNavigationEntry('moderation')).toThrow('Unknown dashboard navigation entry');
    });

    it('keeps unavailable routes in the exhaustive catalog without exposing them in navigation', () => {
        expect(getDashboardCategorySubNavigation('messaging').map((item) => item.id)).toStrictEqual([
            'bluesky',
            'free-game-alerts',
            'message-builder',
        ]);
        expect(dashboardNavigationEntries.map((entry) => entry.category.label)).toStrictEqual([
            'Overview',
            'Create & Deliver',
            'Members & Access',
            'Insights & Activity',
            'Server Blueprint',
            'Settings',
        ]);
        expect(
            dashboardNavigationEntries
                .flatMap((entry) => entry.subNavigation)
                .every((item) => item.status === 'implemented')
        ).toBe(true);
        expect(dashboardCapabilities.find((item) => item.id === 'tickets')).toMatchObject({
            navigationJobId: 'safety-support',
            scope: 'guild',
        });
        expect(dashboardCapabilities.find((item) => item.id === 'oauth-sessions')).toMatchObject({
            navigationJobId: 'settings',
            scope: 'account',
        });
        expect(dashboardCapabilities.find((item) => item.id === 'deployment')).toMatchObject({
            scope: 'platform',
        });
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
