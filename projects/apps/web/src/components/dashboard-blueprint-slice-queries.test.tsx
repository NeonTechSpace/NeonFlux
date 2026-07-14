// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDashboardBlueprintRunsQueryKey } from '../dashboard-query-keys.js';
import { useDashboardBlueprintBackupsQuery } from './dashboard-blueprint-backups-query.js';
import type { DashboardBlueprintExplorerSource } from './dashboard-blueprint-explorer-types.js';
import { createDashboardBlueprintReadRegistry } from './dashboard-blueprint-request-registry.js';
import { useDashboardBlueprintRunsQuery } from './dashboard-blueprint-runs-query.js';
import { DashboardBlueprintRuntimeProvider } from './dashboard-blueprint-runtime-context.js';
import type { DashboardBlueprintDeployFlow } from './dashboard-blueprint-runtime-context.js';

const mocks = vi.hoisted(() => ({ readBackups: vi.fn(), readRuns: vi.fn() }));

vi.mock('../server/dashboard-blueprint-route-data.js', () => ({
    readDashboardBlueprintBackupsRouteData: mocks.readBackups,
    readDashboardBlueprintRunsRouteData: mocks.readRuns,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Blueprint slice queries', () => {
    it('starts the new guild backup slice while the previous guild request is still pending', async () => {
        const guildOneRequest = createDeferred<ReturnType<typeof createBackupsResult>>();
        mocks.readBackups.mockImplementation(({ data }: { data: { guildId: string } }) =>
            data.guildId === 'guild-1' ? guildOneRequest.promise : Promise.resolve(createBackupsResult())
        );
        const queryClient = createQueryClient();
        const view = render(
            <TestQueryProvider queryClient={queryClient} guildId='guild-1'>
                <BackupsQueryState guildId='guild-1' />
            </TestQueryProvider>
        );
        await waitFor(() => expect(mocks.readBackups).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } }));

        try {
            view.rerender(
                <TestQueryProvider queryClient={queryClient} guildId='guild-2'>
                    <BackupsQueryState guildId='guild-2' />
                </TestQueryProvider>
            );
            expect(await screen.findByText('guild-2:success')).toBeTruthy();
            expect(mocks.readBackups).toHaveBeenCalledWith({ data: { guildId: 'guild-2' } });
        } finally {
            guildOneRequest.resolve(createBackupsResult());
            queryClient.clear();
        }
    });

    it('reuses a run read that outlives query cancellation during route replacement', async () => {
        const runsRequest = createDeferred<ReturnType<typeof createRunsResult>>();
        mocks.readRuns.mockReturnValue(runsRequest.promise);
        const queryClient = createQueryClient();
        render(
            <TestQueryProvider queryClient={queryClient} guildId='guild-1'>
                <RunsQueryState guildId='guild-1' />
            </TestQueryProvider>
        );
        await waitFor(() => expect(mocks.readRuns).toHaveBeenCalledTimes(1));

        await act(async () => {
            await queryClient.cancelQueries({ queryKey: getDashboardBlueprintRunsQueryKey('guild-1') });
            const refetch = queryClient.refetchQueries({ queryKey: getDashboardBlueprintRunsQueryKey('guild-1') });
            runsRequest.resolve(createRunsResult());
            await refetch;
        });

        expect(await screen.findByText('guild-1:success')).toBeTruthy();
        expect(mocks.readRuns).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['backups-only', true, false],
        ['runs-only', false, true],
        ['compare', true, true],
    ] as const)('loads only the slices explicitly mounted by %s', async (entry, expectsBackups, expectsRuns) => {
        mocks.readBackups.mockResolvedValue(createBackupsResult());
        mocks.readRuns.mockResolvedValue(createRunsResult());
        render(
            <TestQueryProvider queryClient={createQueryClient()} guildId='guild-1'>
                <MountedSlices entry={entry} />
            </TestQueryProvider>
        );

        await waitFor(() => expect(mocks.readBackups).toHaveBeenCalledTimes(expectsBackups ? 1 : 0));
        await waitFor(() => expect(mocks.readRuns).toHaveBeenCalledTimes(expectsRuns ? 1 : 0));
    });
});

function MountedSlices({ entry }: { entry: 'backups-only' | 'runs-only' | 'compare' }) {
    if (entry === 'backups-only') return <BackupsQueryState guildId='guild-1' />;
    if (entry === 'runs-only') return <RunsQueryState guildId='guild-1' />;
    return <CompareQueryState guildId='guild-1' />;
}

function CompareQueryState({ guildId }: { guildId: string }) {
    useDashboardBlueprintBackupsQuery(guildId);
    useDashboardBlueprintRunsQuery(guildId);
    return null;
}

function BackupsQueryState({ guildId }: { guildId: string }) {
    const query = useDashboardBlueprintBackupsQuery(guildId);
    return <p>{`${guildId}:${query.status}`}</p>;
}

function RunsQueryState({ guildId }: { guildId: string }) {
    const query = useDashboardBlueprintRunsQuery(guildId);
    return <p>{`${guildId}:${query.status}`}</p>;
}

function TestQueryProvider({
    queryClient,
    guildId,
    children,
}: {
    queryClient: QueryClient;
    guildId: string;
    children: ReactNode;
}) {
    const readSlice = useMemo(() => createDashboardBlueprintReadRegistry(guildId), [guildId]);
    const [importJson, setImportJson] = useState('');
    const [structurePolicy, setStructurePolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('synchronize');
    const [deployFlow, setDeployFlow] = useState<DashboardBlueprintDeployFlow>({ type: 'latest' });
    const [comparisonSource, setComparisonSource] = useState<DashboardBlueprintExplorerSource | undefined>();

    return (
        <QueryClientProvider client={queryClient}>
            <DashboardBlueprintRuntimeProvider
                value={{
                    guildId,
                    importJson,
                    setImportJson,
                    structurePolicy,
                    setStructurePolicy,
                    deployFlow,
                    setDeployFlow,
                    comparisonSource,
                    setComparisonSource,
                    navigateToSurface: vi.fn(),
                    readSlice,
                    statusError: null,
                    statusRefreshing: false,
                    retryStatus: vi.fn(),
                    runProgress: { retry: vi.fn(), retrying: false, transport: { mode: 'idle' } },
                }}>
                {children}
            </DashboardBlueprintRuntimeProvider>
        </QueryClientProvider>
    );
}

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    return { type: 'runs' as const, plans: [] };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}
