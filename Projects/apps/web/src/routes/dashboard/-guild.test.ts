// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
    DashboardGuildPageContent,
    dashboardGuildRouteOptions,
    resolveDashboardGuildRouteResult,
    toDashboardGuildRouteResult,
} from '../dashboard.$guildId.js';
import type { DashboardGuildRouteData } from '../dashboard.$guildId.js';

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';

describe('/dashboard/$guildId', () => {
    it('configures a route loader and component', () => {
        expect(typeof dashboardGuildRouteOptions.loader).toBe('function');
        expect(typeof dashboardGuildRouteOptions.component).toBe('function');
    });

    it('maps authorized guild data into route data', () => {
        expect(toDashboardGuildRouteResult(createGuildData())).toStrictEqual(createGuildRouteData());
    });

    it('redirects unauthenticated route results to Fluxer login', () => {
        let thrownError: unknown;

        try {
            resolveDashboardGuildRouteResult({ type: 'auth-required' });
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

    it('maps inaccessible guilds to a generic 404 state', () => {
        expect(toDashboardGuildRouteResult({ type: 'not-found' })).toStrictEqual({
            type: 'unavailable',
            status: 404,
            title: 'Community unavailable',
            message: 'This community is not available for this account.',
        });
    });

    it('maps infrastructure failures to unavailable states', () => {
        expect(toDashboardGuildRouteResult({ type: 'database-error' })).toStrictEqual({
            type: 'unavailable',
            status: 500,
            title: 'Dashboard unavailable',
            message: 'NeonFlux dashboard unavailable.',
        });
        expect(toDashboardGuildRouteResult({ type: 'deployment-config-not-found' })).toStrictEqual({
            type: 'unavailable',
            status: 503,
            title: 'Dashboard unavailable',
            message: 'NeonFlux deployment config unavailable.',
        });
        expect(toDashboardGuildRouteResult({ type: 'guild-lookup-failed' })).toStrictEqual({
            type: 'unavailable',
            status: 502,
            title: 'Dashboard unavailable',
            message: 'NeonFlux dashboard unavailable.',
        });
    });

    it('renders authorized guild detail', () => {
        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));

        expect(screen.getByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(screen.getByText('Community ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByText('Current prefix:')).toBeTruthy();
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Choose server' }).getAttribute('href')).toBe('/dashboard');
    });

    it('shows a clear validation error for invalid command prefixes', () => {
        const { container } = renderWithRouter(
            createElement(DashboardGuildPageContent, { data: createGuildRouteData() })
        );
        const currentView = within(container);

        fireEvent.change(currentView.getByLabelText('New prefix'), { target: { value: 'abc' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Save prefix' }));

        expect(currentView.getByText(COMMAND_PREFIX_INVALID_MESSAGE)).toBeTruthy();
    });

    it('renders the single-instance unauthorized state', () => {
        renderWithRouter(
            createElement(DashboardGuildPageContent, {
                data: {
                    type: 'single-unauthorized',
                    configuredGuildId: 'guild-1',
                    configuredGuildName: 'Configured Community',
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Not authorized' })).toBeTruthy();
        expect(screen.getByText('You are not authorized to modify Configured Community.')).toBeTruthy();
    });

    it('renders generic community unavailable errors', () => {
        renderWithRouter(
            createElement(DashboardGuildPageContent, {
                data: {
                    type: 'unavailable',
                    status: 404,
                    title: 'Community unavailable',
                    message: 'This community is not available for this account.',
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Community unavailable' })).toBeTruthy();
        expect(screen.getByText('This community is not available for this account.')).toBeTruthy();
    });

    it('does not render session, token, or Fluxer user data', () => {
        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));

        expect(document.body.textContent).not.toContain(sessionId);
        expect(document.body.textContent).not.toContain(fluxerUserId);
        expect(document.body.textContent).not.toContain(accessToken);
    });
});

function renderWithRouter(ui: ReactNode): ReturnType<typeof render> {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });
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

function createGuildData(): Parameters<typeof toDashboardGuildRouteResult>[0] {
    return {
        type: 'guild',
        mode: 'multi',
        guild: {
            id: 'guild-1',
            name: 'Guild One',
        },
        commandSettings: {
            prefix: '?',
            isDefaultPrefix: false,
        },
    };
}

function createGuildRouteData(): DashboardGuildRouteData {
    return {
        type: 'guild',
        mode: 'multi',
        guild: {
            id: 'guild-1',
            name: 'Guild One',
        },
        commandSettings: {
            prefix: '?',
            isDefaultPrefix: false,
        },
    };
}

function getRedirectOptions(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('options' in error)) {
        throw new Error('Expected TanStack Router redirect options.');
    }

    return (error as { options: Record<string, unknown> }).options;
}
