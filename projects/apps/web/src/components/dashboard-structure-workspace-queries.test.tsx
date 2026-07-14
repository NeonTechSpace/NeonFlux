// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { DashboardStructureSurface } from './dashboard-structure-panel-view.js';
import { useDashboardStructureWorkspaceQueries } from './dashboard-structure-workspace-queries.js';

const mocks = vi.hoisted(() => ({
    readBackups: vi.fn(),
    readRuns: vi.fn(),
    readStatus: vi.fn(),
}));

vi.mock('../server/dashboard-structure-route-data.js', () => ({
    readDashboardStructureBackupsRouteData: mocks.readBackups,
    readDashboardStructureRunsRouteData: mocks.readRuns,
    readDashboardStructureStatusRouteData: mocks.readStatus,
}));

vi.mock('./dashboard-structure-execution-progress.js', () => ({
    useDashboardStructureExecutionProgress: vi.fn(() => ({
        execution: null,
        issueCode: undefined,
        retry: vi.fn(),
        retrying: false,
        transport: { mode: 'idle' },
    })),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Blueprint workspace queries', () => {
    it('starts the new guild slice while the previous guild request is still pending', async () => {
        const guildOneRequest = createDeferred<ReturnType<typeof createBackupsResult>>();
        mocks.readStatus.mockResolvedValue(createStatusResult());
        mocks.readBackups.mockImplementation(({ data }: { data: { guildId: string } }) =>
            data.guildId === 'guild-1' ? guildOneRequest.promise : Promise.resolve(createBackupsResult())
        );
        const queryClient = createQueryClient();
        const view = render(
            <TestQueryProvider queryClient={queryClient}>
                <QueryState guildId='guild-1' surface='backups' />
            </TestQueryProvider>
        );
        await waitFor(() => expect(mocks.readBackups).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } }));

        try {
            view.rerender(
                <TestQueryProvider queryClient={queryClient}>
                    <QueryState guildId='guild-2' surface='backups' />
                </TestQueryProvider>
            );

            expect(await screen.findByText('guild-2:success')).toBeTruthy();
            expect(mocks.readBackups).toHaveBeenCalledWith({ data: { guildId: 'guild-2' } });
        } finally {
            guildOneRequest.resolve(createBackupsResult());
            queryClient.clear();
        }
    });

    it.each([
        ['current', true, false],
        ['backups', true, false],
        ['compare', true, true],
        ['deploy', false, true],
        ['runs', false, true],
    ] as const)('loads only the slices consumed by %s', async (surface, expectsBackups, expectsRuns) => {
        mocks.readStatus.mockResolvedValue(createStatusResult());
        mocks.readBackups.mockResolvedValue(createBackupsResult());
        mocks.readRuns.mockResolvedValue(createRunsResult());

        render(
            <TestQueryProvider queryClient={createQueryClient()}>
                <SurfaceQueries surface={surface} />
            </TestQueryProvider>
        );

        await waitFor(() => expect(mocks.readStatus).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mocks.readBackups).toHaveBeenCalledTimes(expectsBackups ? 1 : 0));
        await waitFor(() => expect(mocks.readRuns).toHaveBeenCalledTimes(expectsRuns ? 1 : 0));
    });
});

function SurfaceQueries({ surface }: { surface: DashboardStructureSurface }) {
    useDashboardStructureWorkspaceQueries('guild-1', surface);
    return null;
}

function QueryState({ guildId, surface }: { guildId: string; surface: DashboardStructureSurface }) {
    const { backupsQuery, runsQuery } = useDashboardStructureWorkspaceQueries(guildId, surface);
    const query = surface === 'backups' ? backupsQuery : runsQuery;
    return <p>{`${guildId}:${query.status}`}</p>;
}

function TestQueryProvider({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createStatusResult() {
    return { type: 'status' as const };
}

function createBackupsResult() {
    return {
        type: 'backups' as const,
        backups: [],
        backupSettings: { enabled: false, cadenceWeeks: 1, retentionDays: 180 },
        observedState: { observedChangeCount: 0, targetChangeCounts: {}, changedSinceLastBackup: false },
    };
}

function createRunsResult() {
    return { type: 'runs' as const, importRuns: [] };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}
