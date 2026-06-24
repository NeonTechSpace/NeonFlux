// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardGuildPageContent } from '../../components/dashboard-guild-page.js';
import {
    readDashboardCommandSettingsRouteData,
    resolveDashboardGuildRouteResult,
    toDashboardGuildRouteResult,
    updateDashboardCommandPrefixRouteData,
} from '../../server/dashboard-guild-route-data.js';
import type { DashboardGuildRouteData } from '../../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../../server/dashboard-guild-route-data.js';

vi.mock('../../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        readDashboardCommandSettingsRouteData: vi.fn(),
        updateDashboardCommandPrefixRouteData: vi.fn(),
    };
});

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';
let documentVisibilityState = 'visible';

describe('/dashboard/$guildId', () => {
    beforeEach(() => {
        MockEventSource.instances = [];
        documentVisibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => documentVisibilityState,
        });
        vi.stubGlobal('EventSource', MockEventSource);
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('?'));
        vi.mocked(updateDashboardCommandPrefixRouteData).mockResolvedValue({
            type: 'updated',
            commandSettings: {
                prefix: '?',
                isDefaultPrefix: false,
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
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
        expect(screen.getByRole('img', { name: 'Guild One icon' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByText('Current prefix:')).toBeTruthy();
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Choose server' }).getAttribute('href')).toBe('/dashboard');
    });

    it('uses initial command settings without a first-load refetch waterfall', () => {
        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));

        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
        expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands');
    });

    it('invalidates command settings when a visible matching live event arrives', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValueOnce(createCommandSettingsReadResult('$'));

        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );

        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
        expect(screen.getByText('$')).toBeTruthy();
    });

    it('does not invalidate for unrelated guild live events', async () => {
        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-2',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );
        await Promise.resolve();

        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
    });

    it('closes live subscriptions while hidden and refetches once when visible again', async () => {
        renderWithRouter(createElement(DashboardGuildPageContent, { data: createGuildRouteData() }));
        const firstEventSource = MockEventSource.instances.at(0);

        documentVisibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        documentVisibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));

        expect(firstEventSource?.close).toHaveBeenCalledTimes(1);
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
        expect(MockEventSource.instances.at(-1)?.url).toBe('/dashboard/guild-1/events?areas=commands');
        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
    });

    it('does not overwrite dirty prefix input when another source changes the saved value', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('$'));
        const { container } = renderWithRouter(
            createElement(DashboardGuildPageContent, { data: createGuildRouteData() })
        );
        const currentView = within(container);
        const prefixInput = currentView.getByLabelText<HTMLInputElement>('New prefix');

        fireEvent.change(prefixInput, { target: { value: '?1' } });
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );

        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalledTimes(1));
        expect(await currentView.findByText('Command prefix changed elsewhere to $.')).toBeTruthy();
        expect(prefixInput.value).toBe('?1');
    });

    it('disables prefix saving when the input has not changed', () => {
        const { container } = renderWithRouter(
            createElement(DashboardGuildPageContent, { data: createGuildRouteData() })
        );
        const currentView = within(container);

        expect(currentView.getByRole('button', { name: 'Save prefix' }).hasAttribute('disabled')).toBe(true);
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
            iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
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
            iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
        },
        commandSettings: {
            prefix: '?',
            isDefaultPrefix: false,
        },
    };
}

function createCommandSettingsReadResult(prefix: string) {
    return {
        type: 'settings' as const,
        commandSettings: {
            prefix,
            isDefaultPrefix: prefix === '!',
        },
    };
}

function getRedirectOptions(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('options' in error)) {
        throw new Error('Expected TanStack Router redirect options.');
    }

    return (error as { options: Record<string, unknown> }).options;
}

class MockEventSource {
    static instances: MockEventSource[] = [];

    readonly url: string;
    readonly close = vi.fn();
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    private readonly listeners = new Map<string, Set<EventListener>>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();

        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, data: string): void {
        const event = new MessageEvent(type, { data });

        this.onmessage?.(event);

        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}
