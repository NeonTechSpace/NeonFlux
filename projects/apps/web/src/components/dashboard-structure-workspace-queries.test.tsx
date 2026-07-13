// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useDashboardStructureWorkspaceQueries } from './dashboard-structure-workspace-queries.js';

const mocks = vi.hoisted(() => ({
    readSettings: vi.fn(),
}));

vi.mock('../server/dashboard-structure-route-data.js', () => ({
    readDashboardStructureSettingsRouteData: mocks.readSettings,
}));

vi.mock('./dashboard-structure-execution-progress.js', () => ({
    useDashboardStructureExecutionProgress: vi.fn(() => ({ mode: 'idle' })),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Blueprint workspace queries', () => {
    it('starts the new guild load while the previous guild request is still pending', async () => {
        const guildOneRequest = createDeferred<ReturnType<typeof createSettingsResult>>();
        mocks.readSettings.mockImplementation(({ data }: { data: { guildId: string } }) =>
            data.guildId === 'guild-1' ? guildOneRequest.promise : Promise.resolve(createSettingsResult())
        );
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const view = render(
            <TestQueryProvider queryClient={queryClient}>
                <QueryState guildId='guild-1' />
            </TestQueryProvider>
        );
        await waitFor(() => expect(mocks.readSettings).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } }));

        try {
            view.rerender(
                <TestQueryProvider queryClient={queryClient}>
                    <QueryState guildId='guild-2' />
                </TestQueryProvider>
            );

            expect(await screen.findByText('guild-2:success')).toBeTruthy();
            expect(mocks.readSettings).toHaveBeenCalledWith({ data: { guildId: 'guild-2' } });
        } finally {
            guildOneRequest.resolve(createSettingsResult());
            queryClient.clear();
        }
    });
});

function QueryState({ guildId }: { guildId: string }) {
    const { settingsQuery } = useDashboardStructureWorkspaceQueries(guildId);
    return <p>{`${guildId}:${settingsQuery.status}`}</p>;
}

function TestQueryProvider({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function createSettingsResult() {
    return { type: 'settings' as const, importRuns: [] };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}
