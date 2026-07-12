// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardGuildPendingPage } from './dashboard-guild-page.js';

const renderedPages: RenderResult[] = [];

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
        useLocation: ({ select }: { select?: (location: { pathname: string }) => unknown } = {}) =>
            select ? select({ pathname: '/dashboard/guild-2' }) : { pathname: '/dashboard/guild-2' },
    };
});

describe('DashboardGuildPendingPage', () => {
    afterEach(() => {
        for (const renderedPage of renderedPages.splice(0)) {
            renderedPage.unmount();
        }
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
                    pathname='/dashboard/guild-2/access/reaction-roles'
                    activeCategoryId='access'
                />
            )
        );

        const sidebar = screen.getByRole('complementary');
        fireEvent.click(within(sidebar).getByRole('button', { name: 'Switch server, currently Current Guild' }));

        expect(screen.getByLabelText('Current Guild, current server').getAttribute('aria-current')).toBe('page');
        expect(screen.getByLabelText('Target Guild, opening').getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByRole('link', { name: 'Target Guild, opening' })).toBeNull();
        expect(
            within(sidebar)
                .getAllByRole('link', { name: 'Members & Access' })
                .map((link) => link.getAttribute('href'))
        ).toEqual(['/dashboard/guild-1/access/reaction-roles', '/dashboard/guild-1/access/reaction-roles']);
        expect(screen.getByRole('heading', { name: 'Reaction Roles' })).toBeTruthy();
        expect(screen.getByText('Build reaction-backed role menus.')).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Loading Reaction Roles controls' })).toBeTruthy();
        const pendingFeature = screen.getByRole('region', { name: 'Reaction Roles' });
        expect(pendingFeature.getAttribute('data-dashboard-page-width')).toBe('full');
        expect(within(pendingFeature).getByText('Roles & Access')).toBeTruthy();
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
});
