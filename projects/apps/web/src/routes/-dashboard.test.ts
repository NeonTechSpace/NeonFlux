// @vitest-environment jsdom

import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
    DashboardPageContent,
    dashboardRouteOptions,
    resolveDashboardRouteResult,
    toDashboardRouteResult,
} from './dashboard.js';
import type { DashboardRouteData } from './dashboard.js';

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';

describe('/dashboard', () => {
    it('configures a route loader and component', () => {
        expect(typeof dashboardRouteOptions.loader).toBe('function');
        expect(typeof dashboardRouteOptions.component).toBe('function');
    });

    it('maps dashboard data into route data', async () => {
        expect(toDashboardRouteResult(createDashboardData())).toStrictEqual(createDashboardRouteData());
    });

    it('redirects single-instance guild lists to the canonical guild route', () => {
        expect(
            toDashboardRouteResult({
                type: 'dashboard',
                viewModel: {
                    type: 'guild-list',
                    mode: 'single',
                    guilds: [
                        {
                            id: 'guild-1',
                            name: 'Guild One',
                        },
                    ],
                },
            })
        ).toStrictEqual({
            type: 'guild-redirect',
            guildId: 'guild-1',
        });
    });

    it('redirects single-instance unauthorized dashboards to the canonical guild route', () => {
        expect(
            toDashboardRouteResult({
                type: 'dashboard',
                viewModel: {
                    type: 'single-unauthorized',
                    configuredGuildId: 'guild-1',
                    configuredGuildName: 'Configured Community',
                },
            })
        ).toStrictEqual({
            type: 'guild-redirect',
            guildId: 'guild-1',
        });
    });

    it('redirects unauthenticated route results to Fluxer login', () => {
        let thrownError: unknown;

        try {
            resolveDashboardRouteResult({ type: 'auth-required' });
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toBeInstanceOf(Response);
        expect(isRedirect(thrownError)).toBe(true);
        expect(getRedirectOptions(thrownError)).toMatchObject({
            to: '/auth/fluxer/login',
            reloadDocument: true,
        });
    });

    it('redirects guild route results to the canonical guild route', () => {
        let thrownError: unknown;

        try {
            resolveDashboardRouteResult({ type: 'guild-redirect', guildId: 'guild-1' });
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toBeInstanceOf(Response);
        expect(isRedirect(thrownError)).toBe(true);
        expect(JSON.stringify(thrownError)).toContain('/dashboard/$guildId');
        expect(JSON.stringify(thrownError)).toContain('guild-1');
    });

    it('carries an unavailable status for database failures', async () => {
        expect(toDashboardRouteResult({ type: 'database-error' })).toStrictEqual({
            type: 'unavailable',
            status: 500,
            message: 'NeonFlux dashboard unavailable.',
        });
    });

    it('carries a deployment config unavailable status when config is missing', async () => {
        expect(toDashboardRouteResult({ type: 'deployment-config-not-found' })).toStrictEqual({
            type: 'unavailable',
            status: 503,
            message: 'NeonFlux deployment config unavailable.',
        });
    });

    it('renders authorized dashboard communities', () => {
        renderWithRouter(createElement(DashboardPageContent, { data: createDashboardRouteData() }));

        expect(screen.getByRole('heading', { name: 'NeonFlux Dashboard' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Communities' })).toBeTruthy();
        expect(screen.getByRole('link', { name: /Guild One/ }).getAttribute('href')).toBe('/dashboard/guild-1');
    });

    it('renders the single-instance unauthorized state', () => {
        renderWithRouter(
            createElement(DashboardPageContent, {
                data: {
                    type: 'dashboard',
                    viewModel: {
                        type: 'single-unauthorized',
                        configuredGuildId: 'guild-1',
                        configuredGuildName: 'Configured Community',
                    },
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Not authorized' })).toBeTruthy();
        expect(screen.getByText('You are not authorized to modify Configured Community.')).toBeTruthy();
    });

    it('renders the multi-instance empty state', () => {
        renderWithRouter(
            createElement(DashboardPageContent, {
                data: {
                    type: 'dashboard',
                    viewModel: {
                        type: 'multi-empty',
                    },
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'No manageable communities' })).toBeTruthy();
        expect(screen.getByText('No communities are available for this account.')).toBeTruthy();
    });

    it('renders generic dashboard unavailable errors', () => {
        renderWithRouter(
            createElement(DashboardPageContent, {
                data: {
                    type: 'unavailable',
                    status: 502,
                    message: 'NeonFlux dashboard unavailable.',
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Dashboard unavailable' })).toBeTruthy();
        expect(screen.getByText('NeonFlux dashboard unavailable.')).toBeTruthy();
    });

    it('does not render session, token, or Fluxer user data', () => {
        renderWithRouter(createElement(DashboardPageContent, { data: createDashboardRouteData() }));

        expect(document.body.textContent).not.toContain(sessionId);
        expect(document.body.textContent).not.toContain(fluxerUserId);
        expect(document.body.textContent).not.toContain(accessToken);
    });
});

function renderWithRouter(ui: ReactNode): ReturnType<typeof render> {
    const rootRoute = createRootRoute({
        component: () => ui,
    });
    const dashboardRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/dashboard',
    });
    const dashboardGuildRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/dashboard/$guildId',
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([dashboardRoute, dashboardGuildRoute]),
    });
    const providerProps = { router } as ComponentProps<typeof RouterContextProvider>;

    return render(createElement(RouterContextProvider, providerProps, ui));
}

function createDashboardData(): Parameters<typeof toDashboardRouteResult>[0] {
    return {
        type: 'dashboard',
        viewModel: {
            type: 'guild-list',
            mode: 'multi',
            guilds: [
                {
                    id: 'guild-1',
                    name: 'Guild One',
                },
            ],
        },
    };
}

function createDashboardRouteData(): DashboardRouteData {
    return {
        type: 'dashboard',
        viewModel: {
            type: 'guild-list',
            mode: 'multi',
            guilds: [
                {
                    id: 'guild-1',
                    name: 'Guild One',
                },
            ],
        },
    };
}

function getRedirectOptions(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('options' in error)) {
        throw new Error('Expected TanStack Router redirect options.');
    }

    return (error as { options: Record<string, unknown> }).options;
}
