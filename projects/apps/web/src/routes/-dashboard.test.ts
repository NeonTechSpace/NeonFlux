// @vitest-environment jsdom

import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPageContent } from '../components/dashboard-index-page.js';
import { useDashboardDisplayPreferences } from '../components/dashboard-display-preferences-store.js';
import { resolveDashboardRouteResult, toDashboardRouteResult } from '../server/dashboard-route-data.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';
import {
    redirectDashboardGuildSubrouteFallback,
    resolveDashboardGuildRouteResult,
    toDashboardGuildRouteResult,
} from '../server/dashboard-guild-route-data.js';

describe('/dashboard', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_CONVEX_URL', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        window.localStorage.clear();
        useDashboardDisplayPreferences.setState({
            desktopGuildSelectorOpen: false,
            fluidBlobsEnabled: true,
            guildSelectorSortByName: false,
            particlesEnabled: true,
        });
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

    it('keeps single-instance unauthorized dashboards on the server chooser route', () => {
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
            type: 'dashboard',
            viewModel: {
                type: 'single-unauthorized',
                configuredGuildId: 'guild-1',
                configuredGuildName: 'Configured Community',
            },
        });
    });

    it.each([
        { type: 'not-found' as const },
        {
            type: 'single-unauthorized' as const,
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Configured Community',
        },
    ])('redirects an invalid or inaccessible guild route to the dashboard', (guildData) => {
        const routeResult = toDashboardGuildRouteResult(guildData);
        expect(routeResult).toStrictEqual({ type: 'dashboard-redirect' });

        let thrownError: unknown;
        try {
            resolveDashboardGuildRouteResult(routeResult);
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toBeInstanceOf(Response);
        expect(isRedirect(thrownError)).toBe(true);
        expect(getRedirectOptions(thrownError)).toMatchObject({
            to: '/dashboard',
            replace: true,
        });
    });

    it('redirects an unknown subroute of an authorized guild to that guild dashboard', async () => {
        let thrownError: unknown;

        try {
            await redirectDashboardGuildSubrouteFallback('guild-1', async () => ({
                type: 'guild',
                mode: 'multi',
                guild: { id: 'guild-1', name: 'Guild One' },
                manageableGuilds: [{ id: 'guild-1', name: 'Guild One' }],
            }));
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toBeInstanceOf(Response);
        expect(isRedirect(thrownError)).toBe(true);
        expect(getRedirectOptions(thrownError)).toMatchObject({
            to: '/dashboard/$guildId',
            params: { guildId: 'guild-1' },
            replace: true,
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

        expect(screen.getByRole('heading', { name: 'Choose server' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Disable particles' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Open Guild One dashboard' }).getAttribute('href')).toBe(
            '/dashboard/guild-1'
        );
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
        const view = renderWithRouter(
            createElement(DashboardPageContent, {
                data: {
                    type: 'dashboard',
                    viewModel: {
                        type: 'multi-empty',
                    },
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'No servers available' })).toBeTruthy();
        expect(screen.getByText('Sign in with a Fluxer account that can manage at least one server.')).toBeTruthy();
        expect(within(view.container).getByRole('link', { name: 'Use another account' })).toBeTruthy();
        expect(within(view.container).queryByRole('link', { name: 'Invite bot' })).toBeNull();
    });

    it('preserves invite and account recovery when the bot can be invited', () => {
        const view = renderWithRouter(
            createElement(DashboardPageContent, {
                data: {
                    type: 'dashboard',
                    viewModel: {
                        type: 'multi-empty',
                        botInviteUrl: 'https://fluxer.app/oauth2/authorize?client_id=bot',
                    },
                },
            })
        );

        expect(
            screen.getByText('Invite NeonFlux to a server you own, or switch accounts if your servers are elsewhere.')
        ).toBeTruthy();
        expect(within(view.container).getByRole('link', { name: 'Invite bot' })).toBeTruthy();
        expect(within(view.container).getByRole('link', { name: 'Use another account' })).toBeTruthy();
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
});

function renderWithRouter(ui: ReactNode, queryClient = createDashboardQueryClient()): ReturnType<typeof render> {
    const rootRoute = createRootRoute();
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

    return render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RouterContextProvider, providerProps, ui)
        )
    );
}

function createDashboardQueryClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
                    iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
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
