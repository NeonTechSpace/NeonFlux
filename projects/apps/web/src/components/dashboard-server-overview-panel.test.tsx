// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import { DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';

vi.mock('../server/dashboard-guild-route-data.js', async (importActual) => ({
    ...(await importActual<typeof DashboardGuildRouteDataModule>()),
    readDashboardGuildOverviewRouteData: vi.fn(),
}));

let renderedPanel: RenderResult | undefined;

describe('DashboardServerOverviewPanel', () => {
    afterEach(() => {
        renderedPanel?.unmount();
        renderedPanel = undefined;
        vi.clearAllMocks();
    });

    it('uses one compact first-use state until activity is observed', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValue({
            type: 'overview',
            overview: {
                memberFlow: {
                    totalJoins: 0,
                    totalLeaves: 0,
                    netGrowth: 0,
                    graph: [],
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
                },
                messages: {
                    totalMessages: 0,
                    graph: [],
                },
                dataHealth: {
                    hasMemberFlow: false,
                    hasInviteSnapshots: false,
                    hasMessageActivity: false,
                },
            },
        });

        renderOverview();

        expect(await screen.findByRole('heading', { name: 'Listening for activity' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'No member movement yet' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'No message activity yet' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Common tasks' })).toBeNull();
        expect(screen.queryByRole('region', { name: '30-day activity summary' })).toBeNull();
    });
});

function renderOverview(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderedPanel = render(
        <QueryClientProvider client={queryClient}>
            <DashboardServerOverviewPanel guildId='guild-1' />
        </QueryClientProvider>
    );
}
