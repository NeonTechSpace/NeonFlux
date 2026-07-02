// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';

import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { DashboardPageContent } from '../components/dashboard-index-page.js';
import { resolveDashboardRouteResult, toDashboardRouteResult } from '../server/dashboard-route-data.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';

describe('/dashboard', () => {
    it('keeps the server selector on an index route so guild pages render through the dashboard layout', () => {
        const routeTree = readFileSync(findRouteTreePath(), 'utf8');

        expect(routeTree).toContain("DashboardIndexRouteImport } from './routes/dashboard.index'");
        expect(routeTree).toContain('DashboardIndexRoute = DashboardIndexRouteImport.update({');
        expect(routeTree).toContain('getParentRoute: () => DashboardRoute');
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/general'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/messaging'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/invites'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/xp'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/giveaways'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/profile-builder'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/vc-generator'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/tickets'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/community/suggestions'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/audit'");
        expect(routeTree).toContain("fullPath: '/dashboard/$guildId/events'");
        expect(routeTree).toContain("fullPath: '/dashboard/'");
    });

    it('keeps auth-bearing dashboard pending paths from rendering dashboard chrome', () => {
        const dashboardIndexRoute = readWebSourceFile('src/routes/dashboard.index.tsx');
        const dashboardGuildRoute = readWebSourceFile('src/routes/dashboard.$guildId.tsx');
        const router = readWebSourceFile('src/router.tsx');
        const dashboardIndexPage = readWebSourceFile('src/components/dashboard-index-page.tsx');
        const dashboardLayout = readWebSourceFile('src/components/dashboard-layout.tsx');

        expect(dashboardIndexRoute).not.toContain('DashboardRouteLoading');
        expect(dashboardIndexRoute).not.toContain('pendingComponent');
        expect(dashboardIndexRoute).not.toContain('fallback=');
        expect(dashboardIndexRoute).not.toContain('lazy(');
        expect(dashboardGuildRoute).not.toContain('pendingComponent: DashboardRouteLoading');
        expect(dashboardGuildRoute).not.toContain('fallback={<DashboardRouteLoading />}');
        expect(dashboardGuildRoute).toContain('loader: ({ params }) =>');
        expect(dashboardGuildRoute).toContain('loadDashboardGuildRouteData');
        expect(dashboardGuildRoute).toContain('pendingComponent: DashboardGuildPendingRoute');
        expect(dashboardGuildRoute).toContain('readDashboardGuildPreview');
        expect(dashboardGuildRoute).not.toContain('pendingMs: 0');
        expect(dashboardGuildRoute).not.toContain('pendingMinMs: 0');
        expect(router).toContain('defaultPendingMs: 0');
        expect(router).toContain('defaultPendingMinMs: 0');
        expect(dashboardGuildRoute).toContain(
            '<DashboardGuildPageContent data={data} activeCategoryId={activeCategoryId} />'
        );
        expect(dashboardGuildRoute).toContain(
            '<DashboardGuildPendingPage guildId={guildId} preview={preview} activeCategoryId={activeCategoryId} />'
        );
        expect(dashboardIndexPage).toContain("preload='intent'");
        expect(dashboardIndexPage).toContain('withDashboardGuildPreview(preview)');
        expect(dashboardIndexPage).toContain('createDashboardGuildPreview');
        expect(dashboardLayout).toContain("case '/dashboard':");
        expect(dashboardLayout).toContain("<Link to='/dashboard'");
        expect(dashboardLayout).toContain('<a href={actionTo}');
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

        expect(screen.getByRole('heading', { name: 'Choose server' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Manageable servers' })).toBeTruthy();
        expect(screen.getByRole('link', { name: /Guild One/ }).getAttribute('href')).toBe('/dashboard/guild-1');
        expect(document.body.textContent).not.toContain('Community');
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

        expect(screen.getByRole('heading', { name: 'No manageable servers' })).toBeTruthy();
        expect(screen.getByText('Use an account with Manage Server, or invite the bot to a server you own.')).toBeTruthy();
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
                    iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
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

function findRouteTreePath(): string {
    const routeTreePaths = ['apps/web/src/routeTree.gen.ts', 'src/routeTree.gen.ts'];
    const routeTreePath = routeTreePaths.find((path) => existsSync(path));

    if (!routeTreePath) {
        throw new Error('Expected generated TanStack route tree to exist.');
    }

    return routeTreePath;
}

function readWebSourceFile(path: string): string {
    const sourcePaths = [`apps/web/${path}`, path];
    const sourcePath = sourcePaths.find((candidate) => existsSync(candidate));

    if (!sourcePath) {
        throw new Error(`Expected web source file to exist: ${path}`);
    }

    return readFileSync(sourcePath, 'utf8');
}
