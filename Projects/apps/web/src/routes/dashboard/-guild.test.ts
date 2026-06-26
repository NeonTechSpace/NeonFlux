// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardGuildPageContent, DashboardGuildPendingPage } from '../../components/dashboard-guild-page.js';
import {
    postDashboardMessageRouteData,
    readDashboardAuditEventsRouteData,
    readDashboardCommandSettingsRouteData,
    readDashboardPostingChannelsRouteData,
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
        postDashboardMessageRouteData: vi.fn(),
        readDashboardAuditEventsRouteData: vi.fn(),
        readDashboardCommandSettingsRouteData: vi.fn(),
        readDashboardPostingChannelsRouteData: vi.fn(),
        updateDashboardCommandPrefixRouteData: vi.fn(),
    };
});

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';
let renderedViews: Array<ReturnType<typeof render>> = [];
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
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [],
        });
        vi.mocked(readDashboardPostingChannelsRouteData).mockResolvedValue({
            type: 'channels',
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    position: 1,
                },
                {
                    id: 'channel-2',
                    name: 'release-notes',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Info',
                    position: 2,
                },
            ],
        });
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('?'));
        vi.mocked(postDashboardMessageRouteData).mockResolvedValue({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        });
        vi.mocked(updateDashboardCommandPrefixRouteData).mockResolvedValue({
            type: 'updated',
            commandSettings: {
                prefix: '?',
                isDefaultPrefix: false,
            },
        });
    });

    afterEach(() => {
        for (const renderedView of renderedViews) {
            renderedView.unmount();
        }
        renderedViews = [];
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

    it('renders authorized guild detail', async () => {
        renderGuildPage();

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Guild One icon' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Posting' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Audit events' })).toBeTruthy();
        expect(screen.getByText('Current prefix:')).toBeTruthy();
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Choose server' }).getAttribute('href')).toBe('/dashboard');
    });

    it('renders preview guild data only for pending SPA navigation', () => {
        renderWithRouter(
            createElement(DashboardGuildPendingPage, {
                guildId: 'guild-1',
                preview: {
                    id: 'guild-1',
                    name: 'Preview Guild',
                    iconUrl: 'https://fluxerusercontent.com/icons/guild-1/preview.webp?size=80',
                    mode: 'multi',
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Preview Guild' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Preview Guild icon' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByText('Current prefix is loading.')).toBeTruthy();
    });

    it('renders a neutral direct-entry pending shell without fake mode, name, or icon', () => {
        renderWithRouter(createElement(DashboardGuildPendingPage, { guildId: 'guild-1' }));

        expect(screen.getByText('Loading server')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Loading server...' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.queryByText('Dashboard')).toBeNull();
        expect(screen.queryByText('Server guild-1')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Choose server' })).toBeNull();
    });

    it('uses route command settings without a first-load command-settings refetch waterfall', async () => {
        renderGuildPage();

        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit')
        );
    });

    it('invalidates command settings when a visible matching live event arrives', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValueOnce(createCommandSettingsReadResult('$'));

        renderGuildPage();
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit')
        );
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
        renderGuildPage();
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit')
        );
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
        renderGuildPage();
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit')
        );
        const firstEventSource = MockEventSource.instances.at(0);

        documentVisibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        documentVisibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));

        expect(firstEventSource?.close).toHaveBeenCalledTimes(1);
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
        expect(MockEventSource.instances.at(-1)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit');
        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
        expect(screen.queryByText('Refreshing live setting...')).toBeNull();
    });

    it('does not overwrite dirty prefix input when another source changes the saved value', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('$'));
        const { container } = renderGuildPage();
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands%2Caudit')
        );

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

    it('disables prefix saving when the input has not changed', async () => {
        const { container } = renderGuildPage();
        const currentView = within(container);

        expect(await currentView.findByDisplayValue('?')).toBeTruthy();
        expect(currentView.getByRole('button', { name: 'Save prefix' }).hasAttribute('disabled')).toBe(true);
    });

    it('allows typing in the prefix input without throwing', async () => {
        const { container } = renderGuildPage();
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');

        fireEvent.change(prefixInput, { target: { value: '?1' } });

        expect(prefixInput.value).toBe('?1');
    });

    it('shows a clear validation error for invalid command prefixes', async () => {
        const { container } = renderGuildPage();
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue('?');

        fireEvent.change(prefixInput, { target: { value: 'abc' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Save prefix' }));

        expect(await currentView.findByText(COMMAND_PREFIX_INVALID_MESSAGE)).toBeTruthy();
    });

    it('shows a clear validation error for malformed embed JSON before posting', async () => {
        const { container } = renderGuildPage();
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Embed JSON'), { target: { value: '{' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        expect(await currentView.findByText('Embed JSON is not valid JSON.')).toBeTruthy();
        expect(postDashboardMessageRouteData).not.toHaveBeenCalled();
    });

    it('posts dashboard messages with content and embed payloads', async () => {
        vi.mocked(postDashboardMessageRouteData).mockResolvedValueOnce({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-2',
            },
        });
        const { container } = renderGuildPage();
        const currentView = within(container);

        await selectPostingChannel(currentView, 'rel notes', '#release-notes');
        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'hello' } });
        fireEvent.change(currentView.getByLabelText('Embed JSON'), {
            target: { value: '[{"title":"NeonFlux"}]' },
        });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-2',
                    content: 'hello',
                    embeds: [{ title: 'NeonFlux' }],
                },
            })
        );
        expect(await currentView.findByText('Message sent to channel-2.')).toBeTruthy();
    });

    it('renders recent dashboard audit events', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });

        renderGuildPage();

        expect(await screen.findByText('posting: message.sent')).toBeTruthy();
        expect(screen.getByText('Actor: actor-1')).toBeTruthy();
        expect(
            screen.getByText(
                'Channel: channel-1 | Message: message-1 | Content length: 5 | Embeds: 0 | Source: dashboard'
            )
        ).toBeTruthy();
    });

    it('renders the single-instance unauthorized state', async () => {
        renderGuildPage({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Configured Community',
        });

        expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeTruthy();
        expect(screen.getByText('You are not authorized to modify Configured Community.')).toBeTruthy();
    });

    it('renders generic community unavailable errors', async () => {
        renderGuildPage({
            type: 'unavailable',
            status: 404,
            title: 'Community unavailable',
            message: 'This community is not available for this account.',
        });

        expect(await screen.findByRole('heading', { name: 'Community unavailable' })).toBeTruthy();
        expect(screen.getByText('This community is not available for this account.')).toBeTruthy();
    });

    it('does not render session, token, or Fluxer user data', async () => {
        renderGuildPage();

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
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

    const view = render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RouterContextProvider, providerProps, ui)
        )
    );
    renderedViews.push(view);

    return view;
}

function renderGuildPage(routeData: DashboardGuildRouteData = createGuildRouteData()): ReturnType<typeof render> {
    return renderWithRouter(createElement(DashboardGuildPageContent, { data: routeData }));
}

async function selectPostingChannel(
    currentView: ReturnType<typeof within>,
    search: string,
    channelLabel: string
): Promise<void> {
    const channelInput = currentView.getByLabelText('Channel');

    fireEvent.focus(channelInput);
    fireEvent.change(channelInput, { target: { value: search } });
    fireEvent.click(await currentView.findByRole('button', { name: new RegExp(channelLabel) }));
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
