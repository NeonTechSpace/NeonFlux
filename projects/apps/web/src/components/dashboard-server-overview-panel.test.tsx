// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
                windowDays: 30,
                activityPresence: {
                    hasMemberFlow: false,
                    hasMessageActivity: false,
                },
                memberFlow: {
                    totalJoins: 0,
                    totalLeaves: 0,
                    netGrowth: 0,
                    graph: [],
                },
                messages: {
                    totalMessages: 0,
                    graph: [],
                },
            },
        });

        renderOverview();

        expect(await screen.findByRole('heading', { name: 'Listening for activity' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'No member movement yet' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'No member message activity yet' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Common tasks' })).toBeNull();
        expect(screen.queryByRole('region', { name: '30-day activity summary' })).toBeNull();
    });

    it('labels observed messages precisely and exposes chart values as text', async () => {
        await import('./dashboard-server-overview-charts.js');

        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValue({
            type: 'overview',
            overview: {
                oldestRetainedActivityAt: '2026-07-01T00:00:00.000Z',
                windowDays: 30,
                activityPresence: {
                    hasMemberFlow: true,
                    hasMessageActivity: true,
                },
                memberFlow: {
                    totalJoins: 2,
                    totalLeaves: 1,
                    netGrowth: 1,
                    graph: [{ date: '2026-07-01', joins: 2, leaves: 1, netGrowth: 1 }],
                },
                messages: {
                    totalMessages: 4,
                    graph: [{ date: '2026-07-01', messageCount: 4 }],
                },
            },
        });

        renderOverview();

        expect(await screen.findByRole('region', { name: '30-day activity summary' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Member messages' })).toBeTruthy();
        expect(await screen.findByText(/Daily member movement\./u)).toBeTruthy();
        expect(await screen.findByText(/Daily observed member messages\./u)).toBeTruthy();
    });

    it('shows a busy, single-attempt retry without hiding the scoped error', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValueOnce({ type: 'database-error' });
        let resolveRetry: ((value: { type: 'database-error' }) => void) | undefined;
        vi.mocked(readDashboardGuildOverviewRouteData).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRetry = resolve;
                })
        );

        renderOverview();

        fireEvent.click(await screen.findByRole('button', { name: 'Retry overview' }));
        const retrying = await screen.findByRole<HTMLButtonElement>('button', { name: 'Retrying…' });

        expect(retrying.disabled).toBe(true);
        expect(retrying.getAttribute('aria-busy')).toBe('true');
        expect(readDashboardGuildOverviewRouteData).toHaveBeenCalledTimes(2);

        resolveRetry?.({ type: 'database-error' });
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
