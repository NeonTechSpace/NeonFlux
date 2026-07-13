// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DashboardGuildCommandPrefixCategory,
    DashboardGuildPageContent,
    DashboardGuildPendingPage,
} from './dashboard-guild-page.js';
import { getDashboardGuildCatalogQueryKey } from '../dashboard-query-keys.js';

const renderedPages: RenderResult[] = [];
const invalidateRouter = vi.fn(() => Promise.resolve());
const navigate = vi.fn(() => Promise.resolve());

beforeEach(() => {
    vi.stubEnv('VITE_CONVEX_URL', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

    return {
        Link: ({
            to,
            params,
            state: _state,
            preload: _preload,
            activeOptions: _activeOptions,
            children,
            ...props
        }: {
            to: string;
            params?: { guildId: string };
            state?: unknown;
            preload?: unknown;
            activeOptions?: unknown;
            children: ReactNode;
        }) => createElement('a', { ...props, href: params ? to.replace('$guildId', params.guildId) : to }, children),
        Outlet: () => null,
        useRouter: () => ({ invalidate: invalidateRouter }),
        useNavigate: () => navigate,
        useLocation: ({ select }: { select?: (location: { pathname: string }) => unknown } = {}) =>
            select ? select({ pathname: '/dashboard/guild-2' }) : { pathname: '/dashboard/guild-2' },
    };
});

describe('DashboardGuildPendingPage', () => {
    afterEach(() => {
        for (const renderedPage of renderedPages.splice(0)) {
            renderedPage.unmount();
        }
        vi.clearAllMocks();
    });

    it('renders a generic loading shell when no safe guild preview is available', () => {
        renderedPages.push(render(<DashboardGuildPendingPage guildId='untrusted-cold-guild-id' />));

        expect(screen.getByRole('status').textContent).toContain('Loading Server pulse');
        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(document.body.textContent).not.toContain('untrusted-cold-guild-id');
    });

    it('keeps the source server current while the target preview is opening', () => {
        renderedPages.push(
            render(
                <DashboardGuildPendingPage
                    guildId='guild-2'
                    preview={{ id: 'guild-2', name: 'Target Guild', mode: 'multi' }}
                    sourcePreview={{ id: 'guild-1', name: 'Current Guild', mode: 'multi' }}
                    pathname='/dashboard/guild-2/messaging/message-builder'
                    activeCategoryId='messaging'
                />
            )
        );

        const sidebar = screen.getByRole('complementary');
        fireEvent.click(within(sidebar).getByRole('button', { name: 'Switch server, currently Current Guild' }));

        expect(screen.getByLabelText('Current Guild, current server').getAttribute('aria-current')).toBe('page');
        expect(screen.getByLabelText('Target Guild, opening').getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('link', { name: 'Target Guild, opening' })).toBeNull();
        const messagingLinks = within(sidebar).getAllByRole('link', { name: 'Create & Deliver' });
        expect(messagingLinks.length).toBeGreaterThan(0);
        expect(new Set(messagingLinks.map((link) => link.getAttribute('href')))).toEqual(
            new Set(['/dashboard/guild-1/messaging/message-builder'])
        );
        expect(screen.getByRole('heading', { name: 'Message Builder' })).toBeTruthy();
        expect(screen.getByText('Compose, preview, and post Fluxer messages.')).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Loading Message Builder controls' })).toBeTruthy();
        const pendingFeature = screen.getByRole('region', { name: 'Message Builder' });
        expect(within(pendingFeature).getByText('Create & Deliver')).toBeTruthy();
    });

    it('keeps the exact Blueprint surface identity while switching servers', () => {
        renderedPages.push(
            render(
                <DashboardGuildPendingPage
                    guildId='guild-2'
                    preview={{ id: 'guild-2', name: 'Target Guild', mode: 'multi' }}
                    sourcePreview={{ id: 'guild-1', name: 'Current Guild', mode: 'multi' }}
                    pathname='/dashboard/guild-2/structure/backups'
                    activeCategoryId='structure'
                />
            )
        );

        expect(screen.getByRole('heading', { name: 'Protected versions' })).toBeTruthy();
        expect(screen.getByText('Backups provide comparison baselines and deliberate recovery sources.')).toBeTruthy();
    });

    it('keeps an authorized guild shell available when command settings fail to load', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        renderedPages.push(
            render(
                <QueryClientProvider client={queryClient}>
                    <DashboardGuildPageContent
                        data={{
                            type: 'guild',
                            mode: 'multi',
                            guild: { id: 'guild-1', name: 'Guild One' },
                            manageableGuilds: [{ id: 'guild-1', name: 'Guild One' }],
                        }}
                        activeCategoryId='general'>
                        <DashboardGuildCommandPrefixCategory commandSettingsResult={{ type: 'database-error' }} />
                    </DashboardGuildPageContent>
                </QueryClientProvider>
            )
        );

        expect(screen.getByRole('complementary')).toBeTruthy();
        expect(screen.getByText(/rest of this server dashboard is still available/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Retry settings' }));

        expect(invalidateRouter).toHaveBeenCalledTimes(1);
    });

    it('leaves an active workbench when refreshed access no longer includes that server', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        renderedPages.push(
            render(
                <QueryClientProvider client={queryClient}>
                    <DashboardGuildPageContent
                        data={{
                            type: 'guild',
                            mode: 'multi',
                            guild: { id: 'guild-1', name: 'Guild One' },
                            manageableGuilds: [{ id: 'guild-1', name: 'Guild One' }],
                        }}>
                        <div>Authorized feature</div>
                    </DashboardGuildPageContent>
                </QueryClientProvider>
            )
        );

        act(() => {
            queryClient.setQueryData(getDashboardGuildCatalogQueryKey(), {
                guilds: [{ id: 'guild-2', name: 'Guild Two' }],
                mode: 'multi',
            });
        });

        await waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({ to: '/dashboard', replace: true });
        });
    });

    it('lets fresh authorized route data replace an older shared catalog before access-loss handling', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(getDashboardGuildCatalogQueryKey(), {
            guilds: [{ id: 'guild-2', name: 'Guild Two' }],
            mode: 'multi',
        });

        renderedPages.push(
            render(
                <QueryClientProvider client={queryClient}>
                    <DashboardGuildPageContent
                        data={{
                            type: 'guild',
                            mode: 'multi',
                            guild: { id: 'guild-1', name: 'Guild One' },
                            manageableGuilds: [{ id: 'guild-1', name: 'Guild One' }],
                        }}>
                        <div>Authorized feature</div>
                    </DashboardGuildPageContent>
                </QueryClientProvider>
            )
        );

        await waitFor(() => {
            expect(queryClient.getQueryData(getDashboardGuildCatalogQueryKey())).toStrictEqual({
                guilds: [{ id: 'guild-1', name: 'Guild One' }],
                mode: 'multi',
            });
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('resets feature-local state across guilds without clearing either guild cache', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const guildOneKey = ['dashboard', 'guild', 'guild-1', 'test'] as const;
        const guildTwoKey = ['dashboard', 'guild', 'guild-2', 'test'] as const;
        queryClient.setQueryData(guildOneKey, 'guild-one-cache');
        queryClient.setQueryData(guildTwoKey, 'guild-two-cache');

        const view = render(
            <QueryClientProvider client={queryClient}>
                <DashboardGuildPageContent
                    data={{
                        type: 'guild',
                        mode: 'multi',
                        guild: { id: 'guild-1', name: 'Guild One' },
                        manageableGuilds: [
                            { id: 'guild-1', name: 'Guild One' },
                            { id: 'guild-2', name: 'Guild Two' },
                        ],
                    }}>
                    <GuildLocalDraft />
                </DashboardGuildPageContent>
            </QueryClientProvider>
        );
        renderedPages.push(view);
        fireEvent.click(screen.getByRole('button', { name: 'Edit guild-local draft' }));
        expect(screen.getByText('Draft: edited')).toBeTruthy();

        view.rerender(
            <QueryClientProvider client={queryClient}>
                <DashboardGuildPageContent
                    data={{
                        type: 'guild',
                        mode: 'multi',
                        guild: { id: 'guild-2', name: 'Guild Two' },
                        manageableGuilds: [
                            { id: 'guild-1', name: 'Guild One' },
                            { id: 'guild-2', name: 'Guild Two' },
                        ],
                    }}>
                    <GuildLocalDraft />
                </DashboardGuildPageContent>
            </QueryClientProvider>
        );

        expect(screen.getByText('Draft: initial')).toBeTruthy();
        expect(queryClient.getQueryData(guildOneKey)).toBe('guild-one-cache');
        expect(queryClient.getQueryData(guildTwoKey)).toBe('guild-two-cache');
    });

    it('offers retry without presenting stale guild details when the shell access read fails', () => {
        renderedPages.push(
            render(
                <DashboardGuildPageContent
                    data={{
                        type: 'unavailable',
                        status: 502,
                        title: 'Dashboard unavailable',
                        message: 'NeonFlux dashboard unavailable.',
                    }}
                />
            )
        );

        expect(screen.queryByRole('complementary')).toBeNull();
        expect(screen.getByRole('link', { name: 'Choose server' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard' }));

        expect(invalidateRouter).toHaveBeenCalledTimes(1);
    });
});

function GuildLocalDraft() {
    const [draft, setDraft] = useState('initial');
    return (
        <div>
            <p>Draft: {draft}</p>
            <button type='button' onClick={() => setDraft('edited')}>
                Edit guild-local draft
            </button>
        </div>
    );
}
