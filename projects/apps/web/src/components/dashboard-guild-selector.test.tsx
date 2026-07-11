// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';
import { DashboardGuildSelector, getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';

const renderedSelectors: RenderResult[] = [];

describe('DashboardGuildSelector', () => {
    afterEach(() => {
        for (const renderedSelector of renderedSelectors.splice(0)) {
            renderedSelector.unmount();
        }
        window.localStorage.clear();
        useDashboardDisplayPreferences.setState({
            desktopGuildSelectorOpen: false,
            guildSelectorSortByName: false,
            particlesEnabled: true,
            particleBlurEnabled: true,
        });
    });

    it('renders the configured invite action with manageable guilds', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1/access/autoroles'
                botInviteUrl='https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Show server picker' }));

        const inviteLink = screen.getByRole('link', { name: 'Invite bot' });

        expect(inviteLink.getAttribute('href')).toBe(
            'https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8'
        );
        expect(screen.queryByRole('link', { name: 'Guild One' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Guild Two' })).toBeDefined();
    });

    it('hides the invite action when no invite URL is configured', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1/access/autoroles'
            />
        );

        expect(screen.queryByRole('link', { name: /Invite/u })).toBeNull();
    });

    it('excludes the active guild and preserves the dashboard subroute when switching guilds', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={createGuilds()}
                activeGuildId='guild-1'
                pathname='/dashboard/guild-1/access/autoroles'
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Show server picker' }));

        expect(screen.queryByRole('link', { name: 'Guild One' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Guild Two' }).getAttribute('href')).toBe(
            '/dashboard/guild-2/access/autoroles'
        );
    });

    it('opens the compact picker and can sort guilds by name', () => {
        renderGuildSelector(
            <DashboardGuildSelector
                guilds={[
                    { id: 'guild-z', name: 'Zulu Guild' },
                    { id: 'guild-a', name: 'Alpha Guild' },
                ]}
                activeGuildId='guild-z'
                pathname='/dashboard/guild-z/access/autoroles'
            />
        );

        const expandButton = screen.getByRole('button', { name: 'Show server picker' });
        expect(expandButton.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(expandButton);

        const collapseButton = screen.getByRole('button', { name: 'Hide server picker' });
        expect(collapseButton.getAttribute('aria-expanded')).toBe('true');

        const sortButton = screen.getByRole('button', { name: 'Sort servers by name' });

        fireEvent.click(sortButton);

        const guildNames = screen
            .getAllByRole('link')
            .map((link) => link.textContent)
            .filter((text): text is string => Boolean(text))
            .map((text) => {
                if (text.includes('Alpha Guild')) {
                    return 'Alpha Guild';
                }
                if (text.includes('Zulu Guild')) {
                    return 'Zulu Guild';
                }

                return undefined;
            })
            .filter((text): text is 'Alpha Guild' | 'Zulu Guild' => Boolean(text));

        expect(guildNames.slice(0, 1)).toStrictEqual(['Alpha Guild']);
        expect(screen.getByRole('button', { name: 'Use recent server order' })).toBeDefined();
    });

    it('filters manageable guilds without leaking server identifiers', () => {
        const guilds = [
            { id: 'guild-z', name: 'Zulu Guild' },
            { id: 'guild-a', name: 'Alpha Guild' },
            { id: 'guild-b', name: 'Beta Guild' },
        ];

        renderGuildSelector(
            <DashboardGuildSelector guilds={guilds} activeGuildId='guild-z' pathname='/dashboard/guild-z' />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Show server picker' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search servers' }), {
            target: { value: 'beta' },
        });

        expect(screen.getByRole('link', { name: 'Beta Guild' })).toBeDefined();
        expect(screen.queryByRole('link', { name: 'Alpha Guild' })).toBeNull();
        expect(screen.queryByText('guild-b')).toBeNull();
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

function renderGuildSelector(element: ReactElement): void {
    renderedSelectors.push(render(element));
}
