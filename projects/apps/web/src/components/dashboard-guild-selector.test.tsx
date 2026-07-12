// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';
import { DashboardGuildSelector, getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

    return {
        Link: ({
            to,
            state,
            preload: _preload,
            children,
            ...props
        }: {
            to: string;
            state?: (current: { __tempKey?: string }) => {
                dashboardGuildPreview?: { id?: string };
                dashboardGuildSourcePreview?: { id?: string };
            };
            preload?: unknown;
            children: ReactNode;
        }) => {
            const previewState = state?.({ __tempKey: 'test' });

            return createElement(
                'a',
                {
                    ...props,
                    href: to,
                    'data-preview-guild': previewState?.dashboardGuildPreview?.id,
                    'data-preview-source-guild': previewState?.dashboardGuildSourcePreview?.id,
                },
                children
            );
        },
    };
});

const renderedSelectors: RenderResult[] = [];

describe('DashboardGuildSelector', () => {
    afterEach(() => {
        for (const renderedSelector of renderedSelectors.splice(0)) {
            renderedSelector.unmount();
        }
        window.localStorage.clear();
        vi.unstubAllGlobals();
        useDashboardDisplayPreferences.setState({
            desktopGuildSelectorOpen: false,
            guildSelectorSortByName: false,
            particlesEnabled: true,
            particleBlurEnabled: true,
            reducedEffectsEnabled: false,
        });
    });

    it('opens a visual dock with current, manageable, all-server, and configured invite actions', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1/access/autoroles'
                botInviteUrl='https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch server, currently Guild One' }));

        expect(screen.getByLabelText('Guild One, current server').getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'Guild Two' })).toBeDefined();
        expect(screen.getByRole('link', { name: 'All servers' }).getAttribute('href')).toBe('/dashboard');
        expect(screen.getByRole('link', { name: 'Invite bot' }).getAttribute('href')).toBe(
            'https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8'
        );
        expect(document.body.textContent).not.toContain('guild-1');
        expect(document.body.textContent).not.toContain('guild-2');
    });

    it('keeps the multi-instance dock useful with one manageable server', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={[{ id: 'guild-1', name: 'Guild One' }]}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch server, currently Guild One' }));

        expect(screen.getByLabelText('Guild One, current server')).toBeDefined();
        expect(screen.getByRole('link', { name: 'All servers' })).toBeDefined();
        expect(screen.queryByRole('link', { name: /Invite bot/u })).toBeNull();
        expect(screen.queryByRole('searchbox', { name: 'Search servers' })).toBeNull();
    });

    it('preserves the nested path and carries a trusted preview without claiming the switch committed', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1/access/autoroles'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch server, currently Guild One' }));
        const nextGuild = screen.getByRole('link', { name: 'Guild Two' });

        expect(nextGuild.getAttribute('href')).toBe('/dashboard/guild-2/access/autoroles');
        expect(nextGuild.getAttribute('data-preview-guild')).toBe('guild-2');
        expect(nextGuild.getAttribute('data-preview-source-guild')).toBe('guild-1');

        nextGuild.addEventListener('click', (event) => event.preventDefault(), { once: true });
        fireEvent.click(nextGuild);

        expect(screen.getByRole('link', { name: 'Guild Two, opening' }).getAttribute('aria-busy')).toBe('true');
        expect(screen.getByLabelText('Guild One, current server').getAttribute('aria-current')).toBe('page');
        expect(screen.getByText('Opening…')).toBeDefined();
    });

    it('adds searchable, truthfully labelled ordering controls only when the set is large', () => {
        const guilds = createManyGuilds();

        renderGuildSelector(
            <DashboardGuildSelector guilds={guilds} activeGuildId='guild-z' pathname='/dashboard/guild-z' />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch server, currently Zulu Guild' }));
        const sortButton = screen.getByRole('button', { name: 'Sort servers by name' });
        fireEvent.click(sortButton);

        expect(screen.getByRole('button', { name: 'Use default server order' })).toBeDefined();
        expect(screen.queryByRole('button', { name: /recent server order/iu })).toBeNull();

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search servers' }), {
            target: { value: 'beta' },
        });

        expect(screen.getByRole('link', { name: 'Beta Guild' })).toBeDefined();
        expect(screen.queryByRole('link', { name: 'Alpha Guild' })).toBeNull();
        expect(document.body.textContent).not.toContain('guild-b');
    });

    it('opens directly as a mobile dialog and restores trigger focus after Escape', async () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1'
                variant='mobile-header'
                activeLabel='Overview'
            />
        );

        const trigger = screen.getByRole('button', { name: 'Switch server, currently Guild One' });
        fireEvent.click(trigger);

        expect(screen.getByRole('dialog', { name: 'Switch server' })).toBeDefined();
        expect(screen.getByText('Overview')).toBeDefined();

        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => expect(trigger.matches(':focus')).toBe(true));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch server' })).toBeNull());
    });

    it('closes a portaled mobile dock when the layout crosses into desktop', async () => {
        const breakpointListeners = new Set<(event: MediaQueryListEvent) => void>();
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
                breakpointListeners.add(listener),
            removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
                breakpointListeners.delete(listener),
        }));
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1'
                variant='mobile-header'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch server, currently Guild One' }));
        expect(screen.getByRole('dialog', { name: 'Switch server' })).toBeDefined();

        act(() => {
            for (const listener of breakpointListeners) {
                listener({ matches: true } as MediaQueryListEvent);
            }
        });

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch server' })).toBeNull());
    });
});

describe('getDashboardGuildSwitchPath', () => {
    it('replaces the active guild segment while keeping nested dashboard path', () => {
        expect(getDashboardGuildSwitchPath('guild-1', 'guild-2', '/dashboard/guild-1/access/verification')).toBe(
            '/dashboard/guild-2/access/verification'
        );
    });

    it('falls back to the next guild overview outside the active guild route', () => {
        expect(getDashboardGuildSwitchPath('guild-1', 'guild-2', '/dashboard')).toBe('/dashboard/guild-2');
    });
});

function createGuilds() {
    return [
        {
            id: 'guild-1',
            name: 'Guild One',
            iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
        },
        {
            id: 'guild-2',
            name: 'Guild Two',
        },
    ];
}

function createManyGuilds() {
    return [
        { id: 'guild-z', name: 'Zulu Guild' },
        { id: 'guild-d', name: 'Delta Guild' },
        { id: 'guild-a', name: 'Alpha Guild' },
        { id: 'guild-b', name: 'Beta Guild' },
        { id: 'guild-g', name: 'Gamma Guild' },
        { id: 'guild-e', name: 'Epsilon Guild' },
        { id: 'guild-t', name: 'Theta Guild' },
        { id: 'guild-o', name: 'Omega Guild' },
    ];
}

function renderGuildSelector(element: ReactElement): void {
    renderedSelectors.push(render(element));
}
