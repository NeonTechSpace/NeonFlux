// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardGuildCatalog } from '../server/dashboard-guild-catalog-route-data.js';
import { DashboardPageContent } from './dashboard-index-page.js';

const useDashboardGuildCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('./dashboard-guild-catalog.js', () => ({
    useDashboardGuildCatalog: useDashboardGuildCatalogMock,
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, params }: { children: ReactNode; params?: { guildId: string } }) => (
        <a href={params ? `/dashboard/${params.guildId}` : '/dashboard'}>{children}</a>
    ),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('DashboardPageContent live guild catalog', () => {
    it('replaces the full server launcher when the shared catalog changes', () => {
        let catalog: DashboardGuildCatalog = {
            guilds: [{ id: 'guild-1', name: 'Guild One' }],
            mode: 'multi',
        };
        useDashboardGuildCatalogMock.mockImplementation(() => ({ data: catalog }));
        const view = render(
            <DashboardPageContent
                data={{
                    type: 'dashboard',
                    viewModel: {
                        type: 'guild-list',
                        guilds: catalog.guilds,
                        mode: 'multi',
                    },
                }}
            />
        );

        expect(screen.getByText('Guild One')).toBeTruthy();

        catalog = {
            guilds: [{ id: 'guild-2', name: 'Guild Two' }],
            mode: 'multi',
        };
        view.rerender(
            <DashboardPageContent
                data={{
                    type: 'dashboard',
                    viewModel: {
                        type: 'guild-list',
                        guilds: [{ id: 'guild-1', name: 'Guild One' }],
                        mode: 'multi',
                    },
                }}
            />
        );

        expect(screen.queryByText('Guild One')).toBeNull();
        expect(screen.getByText('Guild Two')).toBeTruthy();
    });
});
