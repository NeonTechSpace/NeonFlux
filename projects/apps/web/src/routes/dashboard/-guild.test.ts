// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardCategoryId } from '../../dashboard-categories.js';
import {
    DashboardGuildAccessCategory,
    DashboardGuildAuditCategory,
    DashboardGuildGeneralCategory,
    DashboardGuildInviteTrackingCategory,
    DashboardGuildMessagingCategory,
    DashboardGuildOverviewCategory,
    DashboardGuildPageContent,
    DashboardGuildPendingPage,
    DashboardGuildPlannedCategory,
} from '../../components/dashboard-guild-page.js';
import {
    postDashboardMessageRouteData,
    readDashboardAuditEventsRouteData,
    readDashboardCommandSettingsRouteData,
    readDashboardGuildOverviewRouteData,
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
        readDashboardGuildOverviewRouteData: vi.fn(),
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
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValue({
            type: 'overview',
            overview: createDashboardOverview(),
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

    it('renders the authorized guild overview category by default', async () => {
        renderGuildPage();

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Guild One icon' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Overview' })).toBeTruthy();
        expect(await screen.findByText('Last 30 days')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Member flow' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Message activity' })).toBeTruthy();
        expect(
            screen.getByText(
                'No member flow recorded yet. The chart stays on the baseline until join or leave events arrive.'
            )
        ).toBeTruthy();
        expect(
            screen.getByText('No messages counted yet. The chart stays flat until new non-bot messages are tracked.')
        ).toBeTruthy();
        expect(screen.queryByText('Data health')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Top inviters' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Audit events' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Instance mode' })).toBeNull();
        expect(screen.queryByText('This bot can manage multiple servers.')).toBeNull();
        expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'General' }).getAttribute('href')).toBe('/dashboard/guild-1/general');
        expect(screen.getByRole('link', { name: 'Messaging' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/messaging'
        );
        expect(screen.getByRole('link', { name: 'Invite Tracking' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/invites'
        );
        expect(screen.getByRole('link', { name: 'Audit Events' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/audit'
        );
        expect(screen.getByLabelText('Dashboard category')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Choose server' }).getAttribute('href')).toBe('/dashboard');
    });

    it('renders populated overview metrics and graph data without invite tracker details', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValueOnce({
            type: 'overview',
            overview: createDashboardOverview({
                trackingStartedAt: '2026-06-25T00:00:00.000Z',
                memberFlow: {
                    totalJoins: 3,
                    totalLeaves: 1,
                    netGrowth: 2,
                    graph: [
                        { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                        { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                    ],
                },
                invites: {
                    activeInviteCount: 3,
                    totalInviteUses: 16,
                    attribution: {
                        attributed: 3,
                        baselineMissing: 0,
                        ambiguous: 0,
                        unavailable: 1,
                        notApplicable: 1,
                    },
                    topInviters: [
                        {
                            inviterUserId: 'inviter-1',
                            attributedJoins: 3,
                            inviteCodes: [
                                { code: 'alpha', uses: 5, active: true },
                                { code: 'beta', uses: 3, active: true },
                            ],
                        },
                        {
                            inviterUserId: 'inviter-2',
                            attributedJoins: 1,
                            inviteCodes: [{ code: 'gamma', uses: 8, active: true }],
                        },
                    ],
                },
                messages: {
                    totalMessages: 12,
                    graph: [
                        { date: '2026-06-25', messageCount: 4 },
                        { date: '2026-06-26', messageCount: 8 },
                    ],
                    topChannels: [{ channelId: 'channel-1', messageCount: 12 }],
                },
                dataHealth: {
                    hasMemberFlow: true,
                    hasInviteSnapshots: true,
                    hasMessageActivity: true,
                },
            }),
        });

        renderGuildPage();

        expect(await screen.findByText('+2')).toBeTruthy();
        expect(screen.getByText('3 joins / 1 leaves')).toBeTruthy();
        expect(screen.getByText('12 in the busiest tracked channel')).toBeTruthy();
        expect(screen.queryByText('16 tracked uses')).toBeNull();
        expect(screen.queryByText('alpha · 5 uses')).toBeNull();
        expect(screen.queryByRole('region', { name: 'Top inviters' })).toBeNull();
    });

    it('renders the routed invite tracking category with grouped top inviters', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValueOnce({
            type: 'overview',
            overview: createDashboardOverview({
                invites: {
                    activeInviteCount: 3,
                    totalInviteUses: 16,
                    attribution: {
                        attributed: 3,
                        baselineMissing: 0,
                        ambiguous: 0,
                        unavailable: 1,
                        notApplicable: 1,
                    },
                    topInviters: [
                        {
                            inviterUserId: 'inviter-1',
                            attributedJoins: 3,
                            inviteCodes: [
                                { code: 'alpha', uses: 5, active: true },
                                { code: 'beta', uses: 3, active: true },
                            ],
                        },
                        {
                            inviterUserId: 'inviter-2',
                            attributedJoins: 1,
                            inviteCodes: [{ code: 'gamma', uses: 8, active: true }],
                        },
                    ],
                },
                dataHealth: {
                    hasMemberFlow: false,
                    hasInviteSnapshots: true,
                    hasMessageActivity: false,
                },
            }),
        });

        renderGuildPage(createGuildRouteData(), 'invites');

        expect(await screen.findByRole('region', { name: 'Invite Tracking' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Top inviters' })).toBeTruthy();
        expect(screen.getByText('Active invites')).toBeTruthy();
        expect(screen.getByText('16 tracked uses')).toBeTruthy();
        expect(screen.getByText('alpha · 5 uses')).toBeTruthy();
        expect(screen.getByText('beta · 3 uses')).toBeTruthy();
        expect(screen.getByText('gamma · 8 uses')).toBeTruthy();
        expect(screen.getByText('1 joins could not be attributed because invite data was unavailable.')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Invite Tracking' }).getAttribute('aria-current')).toBe('page');

        const topInvitersPanel = screen.getByRole('region', { name: 'Top inviters' });

        fireEvent.change(within(topInvitersPanel).getByLabelText('Sort inviters'), { target: { value: 'uses' } });

        expect(within(topInvitersPanel).getByLabelText<HTMLSelectElement>('Sort inviters').value).toBe('uses');
    });

    it('renders the routed general category', async () => {
        renderGuildPage(createGuildRouteData(), 'general');

        expect(await screen.findByRole('region', { name: 'General' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByText('Current prefix:')).toBeTruthy();
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed messaging category', async () => {
        renderGuildPage(createGuildRouteData(), 'messaging');

        expect(await screen.findByRole('region', { name: 'Messaging' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Posting' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Messaging' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed audit category', async () => {
        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByRole('region', { name: 'Audit Events' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Audit events' })).toBeTruthy();
        expect(screen.getByLabelText('Search events')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Audit Events' }).getAttribute('aria-current')).toBe('page');
    });

    it('navigates from the mobile category selector', async () => {
        const view = renderGuildPage();
        const categorySelect = screen.getByLabelText('Dashboard category');

        fireEvent.change(categorySelect, { target: { value: 'audit' } });

        await waitFor(() => expect(view.router.state.location.pathname).toBe('/dashboard/guild-1/audit'));
    });

    it('renders routed placeholder categories without fake controls', async () => {
        renderGuildPage(createGuildRouteData(), 'moderation');

        expect(await screen.findByRole('region', { name: 'Moderation' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Moderation is not built yet' })).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
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
        expect(screen.getByText('Loading settings')).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'Dashboard categories' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Overview' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Messaging' })).toBeTruthy();
    });

    it('renders a neutral direct-entry pending shell without fake mode, name, or icon', () => {
        renderWithRouter(createElement(DashboardGuildPendingPage, { guildId: 'guild-1' }));

        expect(screen.getByText('Loading server')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Loading server...' })).toBeTruthy();
        expect(screen.getByText('Server ID: guild-1')).toBeTruthy();
        expect(screen.getByText('Loading server settings for this section.')).toBeTruthy();
        expect(screen.queryByText('Dashboard')).toBeNull();
        expect(screen.queryByText('Server guild-1')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Choose server' })).toBeNull();
    });

    it('uses route command settings without a first-load command-settings refetch waterfall', async () => {
        renderGuildPage(createGuildRouteData(), 'general');

        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
    });

    it('invalidates command settings when a visible matching live event arrives', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValueOnce(createCommandSettingsReadResult('$'));

        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
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
        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
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
        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
        const firstEventSource = MockEventSource.instances.at(0);

        documentVisibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        documentVisibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));

        expect(firstEventSource?.close).toHaveBeenCalledTimes(1);
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
        expect(MockEventSource.instances.at(-1)?.url).toBe('/dashboard/guild-1/events?areas=commands');
        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
        expect(screen.queryByText('Refreshing live setting...')).toBeNull();
    });

    it('does not overwrite dirty prefix input when another source changes the saved value', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('$'));
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
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
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);

        expect(await currentView.findByDisplayValue('?')).toBeTruthy();
        expect(currentView.getByRole('button', { name: 'Save prefix' }).hasAttribute('disabled')).toBe(true);
    });

    it('allows typing in the prefix input without throwing', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');

        fireEvent.change(prefixInput, { target: { value: '?1' } });

        expect(prefixInput.value).toBe('?1');
    });

    it('shows a clear validation error for invalid command prefixes', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue('?');

        fireEvent.change(prefixInput, { target: { value: 'abc' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Save prefix' }));

        expect(await currentView.findByText(COMMAND_PREFIX_INVALID_MESSAGE)).toBeTruthy();
    });

    it('shows a clear validation error for malformed embed JSON before posting', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.click(currentView.getByLabelText('Advanced JSON'));
        fireEvent.change(currentView.getByLabelText('Embed JSON'), { target: { value: '{' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        expect(await currentView.findByText('Embed JSON is not valid JSON.')).toBeTruthy();
        expect(postDashboardMessageRouteData).not.toHaveBeenCalled();
    });

    it('posts dashboard messages with content and builder embed payloads', async () => {
        vi.mocked(postDashboardMessageRouteData).mockResolvedValueOnce({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-2',
            },
        });
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'rel notes', '#release-notes');
        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'hello' } });
        const sidebarColorInput = currentView.getByLabelText<HTMLInputElement>('Sidebar color');

        expect(sidebarColorInput.type).toBe('color');
        expect(currentView.queryByRole('checkbox', { name: 'Include sidebar color' })).toBeNull();

        fireEvent.change(sidebarColorInput, { target: { value: '#ff00aa' } });
        fireEvent.change(currentView.getByLabelText('Author name'), { target: { value: 'NeonFlux' } });
        fireEvent.change(currentView.getByLabelText('Author icon URL'), {
            target: { value: 'https://example.com/author.png' },
        });
        fireEvent.change(currentView.getByLabelText('Author link URL'), {
            target: { value: 'https://example.com/author' },
        });
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Release notes' } });
        fireEvent.change(currentView.getByLabelText('Title URL'), {
            target: { value: 'https://example.com/releases' },
        });
        fireEvent.change(currentView.getByLabelText('Main body'), {
            target: { value: 'Fluxer update' },
        });
        fireEvent.change(currentView.getByLabelText('Thumbnail URL'), {
            target: { value: 'https://example.com/thumb.png' },
        });
        fireEvent.change(currentView.getByLabelText('Image URL'), {
            target: { value: 'https://example.com/image.png' },
        });
        fireEvent.change(currentView.getByLabelText('Footer text'), { target: { value: 'NeonFlux footer' } });
        fireEvent.change(currentView.getByLabelText('Footer icon URL'), {
            target: { value: 'https://example.com/footer.png' },
        });
        fireEvent.click(currentView.getByLabelText('Timestamp'));
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-2',
                    content: 'hello',
                    embeds: [
                        {
                            color: 16711850,
                            author: {
                                name: 'NeonFlux',
                                icon_url: 'https://example.com/author.png',
                                url: 'https://example.com/author',
                            },
                            title: 'Release notes',
                            url: 'https://example.com/releases',
                            description: 'Fluxer update',
                            thumbnail: {
                                url: 'https://example.com/thumb.png',
                            },
                            image: {
                                url: 'https://example.com/image.png',
                            },
                            footer: {
                                text: 'NeonFlux footer',
                                icon_url: 'https://example.com/footer.png',
                            },
                            timestamp: expect.any(String),
                        },
                    ],
                },
            })
        );
        expect(await currentView.findByText('Message sent to #release-notes.')).toBeTruthy();
    });

    it('updates builder embed color directly from the color picker', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Color test' } });
        fireEvent.change(currentView.getByLabelText('Sidebar color'), { target: { value: '#3366ff' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [
                        {
                            color: 3368703,
                            title: 'Color test',
                        },
                    ],
                },
            })
        );
    });

    it('keeps content-only posting working with an empty builder', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'plain text only' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    content: 'plain text only',
                    embeds: [],
                },
            })
        );
    });

    it('omits empty builder embed fields from the outgoing payload', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'NeonFlux' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ title: 'NeonFlux' }],
                },
            })
        );
    });

    it('sends embed-only builder payloads', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Main body'), { target: { value: 'Embed-only update' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ description: 'Embed-only update' }],
                },
            })
        );
    });

    it('keeps advanced JSON mode for custom multi-embed payloads', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.click(currentView.getByLabelText('Advanced JSON'));
        fireEvent.change(currentView.getByLabelText('Embed JSON'), {
            target: { value: '[{"title":"One"},{"title":"Two"}]' },
        });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ title: 'One' }, { title: 'Two' }],
                },
            })
        );
    });

    it('updates the posting preview from message content and builder fields', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);
        const preview = within(currentView.getByRole('region', { name: 'Message preview' }));

        expect(preview.getByText('Nothing to preview.')).toBeTruthy();

        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'plain preview' } });
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Preview title' } });
        fireEvent.change(currentView.getByLabelText('Main body'), { target: { value: 'Preview body' } });
        fireEvent.change(currentView.getByLabelText('Footer text'), { target: { value: 'Preview footer' } });

        expect(preview.getByText('plain preview')).toBeTruthy();
        expect(preview.getByText('Preview title')).toBeTruthy();
        expect(preview.getByText('Preview body')).toBeTruthy();
        expect(preview.getByText('Preview footer')).toBeTruthy();
    });

    it('renders structured audit events and searches within the selected field', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
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
                {
                    id: 'event-2',
                    feature: 'settings',
                    action: 'prefix.updated',
                    actorUserId: 'actor-2',
                    targetId: 'prefix',
                    metadata: {
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T01:00:00.000Z',
                },
            ],
        });
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
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
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
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

        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByText('message.sent')).toBeTruthy();
        expect(screen.getByText('prefix.updated')).toBeTruthy();
        expect(screen.getByText('Loaded 2 events.')).toBeTruthy();
        expect(screen.getByText('#general')).toBeTruthy();
        expect(screen.getByText('channel-1')).toBeTruthy();
        expect(screen.getByText('message-1')).toBeTruthy();
        expect(screen.getByText('@neonsy')).toBeTruthy();
        expect(screen.getByText('actor-1')).toBeTruthy();
        expect(screen.getByText('Content length')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Search in'), { target: { value: 'channel' } });
        fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'channel-1' } });

        await waitFor(() =>
            expect(readDashboardAuditEventsRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    limit: 40,
                    search: 'channel-1',
                    searchScope: 'channel',
                    searchOffsetMinutes: expect.any(Number),
                },
            })
        );
        expect(await screen.findByText('message.sent')).toBeTruthy();
        expect(screen.queryByText('prefix.updated')).toBeNull();
        expect(screen.getByText('Loaded 1 matching channel events.')).toBeTruthy();
    });

    it('loads older persisted dashboard audit events from the next cursor', async () => {
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
            nextCursor: 'cursor-1',
        });
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-2',
                    feature: 'settings',
                    action: 'prefix.updated',
                    actorUserId: 'actor-2',
                    targetId: 'prefix',
                    metadata: {
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-25T00:00:00.000Z',
                },
            ],
        });

        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByText('message.sent')).toBeTruthy();
        await waitFor(() =>
            expect(readDashboardAuditEventsRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    cursor: 'cursor-1',
                    limit: 40,
                    searchScope: 'all',
                    searchOffsetMinutes: expect.any(Number),
                },
            })
        );
        expect(await screen.findByText('prefix.updated')).toBeTruthy();
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

type RouterTestRender = ReturnType<typeof render> & {
    router: {
        state: {
            location: {
                pathname: string;
            };
        };
    };
};

function renderWithRouter(ui: ReactNode): RouterTestRender {
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
    const dashboardGuildIndexRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: '/',
    });
    const dashboardGuildGeneralRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'general',
    });
    const dashboardGuildMessagingRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'messaging',
    });
    const dashboardGuildInvitesRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'invites',
    });
    const dashboardGuildAccessRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'access',
    });
    const dashboardGuildModerationRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'moderation',
    });
    const dashboardGuildLoggingRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'logging',
    });
    const dashboardGuildCommunityRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'community',
    });
    const dashboardGuildStructureRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'structure',
    });
    const dashboardGuildAuditRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'audit',
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            dashboardRoute.addChildren([
                dashboardGuildRoute.addChildren([
                    dashboardGuildIndexRoute,
                    dashboardGuildGeneralRoute,
                    dashboardGuildMessagingRoute,
                    dashboardGuildInvitesRoute,
                    dashboardGuildAccessRoute,
                    dashboardGuildModerationRoute,
                    dashboardGuildLoggingRoute,
                    dashboardGuildCommunityRoute,
                    dashboardGuildStructureRoute,
                    dashboardGuildAuditRoute,
                ]),
            ]),
        ]),
    });
    const providerProps = { router } as ComponentProps<typeof RouterContextProvider>;

    const view = render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RouterContextProvider, providerProps, ui)
        )
    ) as RouterTestRender;
    view.router = router;
    renderedViews.push(view);

    return view;
}

function renderGuildPage(
    routeData: DashboardGuildRouteData = createGuildRouteData(),
    categoryId: DashboardCategoryId = 'overview'
): RouterTestRender {
    return renderWithRouter(
        createElement(
            DashboardGuildPageContent,
            { data: routeData, activeCategoryId: categoryId },
            createDashboardCategoryElement(categoryId)
        )
    );
}

function createDashboardCategoryElement(categoryId: DashboardCategoryId): ReactNode {
    switch (categoryId) {
        case 'overview':
            return createElement(DashboardGuildOverviewCategory);

        case 'general':
            return createElement(DashboardGuildGeneralCategory);

        case 'messaging':
            return createElement(DashboardGuildMessagingCategory);

        case 'invites':
            return createElement(DashboardGuildInviteTrackingCategory);

        case 'access':
            return createElement(DashboardGuildAccessCategory);

        case 'audit':
            return createElement(DashboardGuildAuditCategory);

        case 'moderation':
        case 'logging':
        case 'community':
        case 'structure':
            return createElement(DashboardGuildPlannedCategory, { categoryId });
    }
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

function createDashboardOverview(overrides: Partial<DashboardOverviewTestData> = {}): DashboardOverviewTestData {
    return {
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        invites: {
            activeInviteCount: 0,
            totalInviteUses: 0,
            attribution: {
                attributed: 0,
                baselineMissing: 0,
                ambiguous: 0,
                unavailable: 0,
                notApplicable: 0,
            },
            topInviters: [],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
            topChannels: [],
        },
        dataHealth: {
            hasMemberFlow: false,
            hasInviteSnapshots: false,
            hasMessageActivity: false,
        },
        ...overrides,
    };
}

type DashboardOverviewTestData = Extract<
    Awaited<ReturnType<typeof readDashboardGuildOverviewRouteData>>,
    { type: 'overview' }
>['overview'];

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
