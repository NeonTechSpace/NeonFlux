// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-contracts.js';
import { useDashboardStructureExecutionProgress } from './dashboard-structure-execution-progress.js';

type WatchCallback = () => void;

type MockLiveClient = {
    callback?: WatchCallback;
    localQueryResult: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
};

const unmountViews: Array<() => void> = [];

const mocks = vi.hoisted(() => {
    const liveClient = vi.fn();
    return {
        fetchToken: vi.fn(),
        httpClient: vi.fn(),
        httpQuery: vi.fn(),
        liveClient,
        liveClients: [] as MockLiveClient[],
        restartLiveTransport: vi.fn(),
        sharedLiveClient: { watchQuery: liveClient },
    };
});

vi.mock('convex/browser', () => ({
    ConvexHttpClient: mocks.httpClient,
}));

vi.mock('./dashboard-live-provider.js', () => ({
    fetchDashboardConvexToken: mocks.fetchToken,
    readDashboardConvexUrl: () => 'https://dashboard-progress.convex.cloud',
    useDashboardLive: () => ({
        client: mocks.sharedLiveClient,
        confirmManageableGuildScope: vi.fn(),
        restart: mocks.restartLiveTransport,
        status: { authentication: 'authenticated', generation: 1, phase: 'connected' },
    }),
}));

describe('Server Blueprint progress transport', () => {
    beforeEach(() => {
        unmountViews.length = 0;
        mocks.fetchToken.mockReset().mockResolvedValue('progress-token');
        mocks.httpQuery.mockReset();
        mocks.httpClient.mockReset().mockImplementation(function MockHttpClient() {
            return { query: mocks.httpQuery };
        });
        mocks.liveClients.length = 0;
        mocks.restartLiveTransport.mockReset();
        mocks.liveClient.mockReset().mockImplementation(function MockWatchQuery() {
            const client: MockLiveClient = {
                localQueryResult: vi.fn(() => undefined),
                unsubscribe: vi.fn(),
            };
            const watch = {
                localQueryResult: client.localQueryResult,
                onUpdate: (callback: WatchCallback) => {
                    client.callback = callback;
                    return client.unsubscribe;
                },
            };
            mocks.liveClients.push(client);
            return watch;
        });
    });

    afterEach(() => {
        for (const unmount of unmountViews) unmount();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('stays idle when no deployment run is active', () => {
        renderProgress({ initialExecution: undefined, runId: undefined });

        expect(screen.getByTestId('progress').textContent).toBe('none');
        expect(screen.getByTestId('issue').textContent).toBe('none');
        expect(screen.getByTestId('transport').textContent).toBe('idle:unconfirmed');
        expect(mocks.httpQuery).not.toHaveBeenCalled();
        expect(mocks.liveClient).not.toHaveBeenCalled();
    });

    it('uses the authenticated polling read when the live watch fails', async () => {
        const poll = deferred<ExecutionQueryResult>();
        mocks.httpQuery.mockReturnValue(poll.promise);
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockImplementation(() => {
            throw new Error('live socket read failed');
        });
        liveClient.callback?.();
        poll.resolve(executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' }));

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        expect(screen.getByTestId('issue').textContent).toBe('none');
        expect(screen.getByTestId('transport').textContent).toBe('polling:confirmed');
    });

    it('keeps live progress healthy when the polling read fails', async () => {
        mocks.httpQuery.mockRejectedValue(new Error('progress polling unavailable'));
        const { queryClient } = renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockReturnValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        liveClient.callback?.();

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        await waitFor(() =>
            expect(queryClient.getQueryState(structureProgressKey('guild-1', 'run-1'))?.status).toBe('error')
        );
        expect(screen.getByTestId('issue').textContent).toBe('none');
        expect(screen.getByTestId('transport').textContent).toBe('live:confirmed');
    });

    it('retains the last confirmed progress when both transports fail', async () => {
        mocks.httpQuery.mockResolvedValueOnce(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockImplementation(() => {
            throw new Error('live socket read failed');
        });
        liveClient.callback?.();
        mocks.httpQuery.mockRejectedValue(new Error('progress network unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));

        await waitFor(() => expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_PROGRESS_READ_FAILED'));
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2');
        expect(screen.getByTestId('transport').textContent).toBe('reconnecting:unconfirmed');
    });

    it('cancels a poisoned token request so an explicit retry can recover', async () => {
        let stalledSignal: AbortSignal | undefined;
        mocks.fetchToken.mockImplementationOnce((signal?: AbortSignal) => {
            stalledSignal = signal;
            return new Promise<string>(() => undefined);
        });
        mocks.httpQuery.mockResolvedValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.fetchToken).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        expect(stalledSignal?.aborted).toBe(true);
        expect(mocks.fetchToken).toHaveBeenCalledTimes(2);
        expect(mocks.restartLiveTransport).toHaveBeenCalledOnce();
        expect(screen.getByTestId('issue').textContent).toBe('none');
    });

    it('expires old transport success and reports a later dual-transport stall', async () => {
        mocks.httpQuery.mockResolvedValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        const { queryClient } = renderProgress({ initialExecution: execution(), runId: 'run-1' });
        const queryKey = structureProgressKey('guild-1', 'run-1');

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        vi.useFakeTimers();
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockReturnValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        act(() => liveClient.callback?.());
        mocks.httpQuery.mockReturnValue(new Promise<ExecutionQueryResult>(() => undefined));

        await act(async () => {
            const refetch = queryClient.refetchQueries({ queryKey });
            await vi.advanceTimersByTimeAsync(60_000);
            await refetch;
        });

        expect(queryClient.getQueryState(queryKey)?.error).toMatchObject({
            name: 'TimeoutError',
        });
        expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_PROGRESS_TIMEOUT');
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2');
    });

    it('keeps terminal progress sticky and refreshes the canonical workspace once', async () => {
        mocks.httpQuery.mockResolvedValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        const { queryClient } = renderProgress({ initialExecution: execution(), runId: 'run-1' });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:1/2'));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockReturnValue(
            executionQueryResult({
                appliedActions: 2,
                completedAt: '2026-07-11T12:00:02.000Z',
                phase: 'complete',
                status: 'succeeded',
                updatedAt: '2026-07-11T12:00:02.000Z',
            })
        );
        liveClient.callback?.();

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:succeeded:2/2'));
        await waitFor(() =>
            expect(
                invalidate.mock.calls.filter(
                    ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(structureSettingsKey('guild-1'))
                )
            ).toHaveLength(1)
        );

        mocks.httpQuery.mockResolvedValue(
            executionQueryResult({ appliedActions: 1, updatedAt: '2026-07-11T12:00:01.000Z' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
        await waitFor(() => expect(mocks.httpQuery.mock.calls.length).toBeGreaterThan(1));

        expect(screen.getByTestId('progress').textContent).toBe('run-1:succeeded:2/2');
        expect(
            invalidate.mock.calls.filter(
                ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(structureSettingsKey('guild-1'))
            )
        ).toHaveLength(1);
    });

    it('does not let updates from the previous run replace the selected run', async () => {
        mocks.httpQuery.mockImplementation((_query, args: { runId: string }) =>
            Promise.resolve(
                executionQueryResult({
                    id: args.runId,
                    totalActions: args.runId === 'run-1' ? 2 : 4,
                    updatedAt: '2026-07-11T12:00:01.000Z',
                })
            )
        );
        const view = renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-1:running:0/2'));
        const oldLiveClient = mocks.liveClients[0];
        view.rerender(
            <ProgressProvider queryClient={view.queryClient}>
                <ProgressProbe initialExecution={execution({ id: 'run-2', totalActions: 4 })} runId='run-2' />
            </ProgressProvider>
        );
        await waitFor(() => expect(screen.getByTestId('progress').textContent).toBe('run-2:running:0/4'));

        oldLiveClient.localQueryResult.mockReturnValue(
            executionQueryResult({
                appliedActions: 2,
                completedAt: '2026-07-11T12:00:02.000Z',
                id: 'run-1',
                phase: 'complete',
                status: 'succeeded',
                updatedAt: '2026-07-11T12:00:02.000Z',
            })
        );
        oldLiveClient.callback?.();

        expect(screen.getByTestId('progress').textContent).toBe('run-2:running:0/4');
        await waitFor(() => expect(oldLiveClient.unsubscribe).toHaveBeenCalledOnce());
    });

    it('identifies a missing progress function as backend incompatibility without polling retries', async () => {
        const missingFunction = new Error(
            "Could not find public function for 'structure:findStructureImportExecutionProgressForGuild'"
        );
        mocks.httpQuery.mockRejectedValue(missingFunction);
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockImplementation(() => {
            throw missingFunction;
        });
        liveClient.callback?.();

        await waitFor(() =>
            expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE')
        );
        expect(mocks.httpQuery).toHaveBeenCalledOnce();
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:0/2');
    });

    it.each([
        [
            'protocol validator rejection',
            new Error(
                'ArgumentValidationError: Value does not match validator. Path: .protocolVersion Value: 1 Validator: v.literal(2)'
            ),
        ],
        ['explicit protocol version mismatch', new Error('Execution protocolVersion mismatch: expected 2, received 1')],
    ])('identifies a %s as backend incompatibility without polling retries', async (_label, contractError) => {
        mocks.httpQuery.mockRejectedValue(contractError);
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockImplementation(() => {
            throw contractError;
        });
        liveClient.callback?.();

        await waitFor(() =>
            expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE')
        );
        expect(mocks.httpQuery).toHaveBeenCalledOnce();
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:0/2');
    });

    it('distinguishes an incompatible durable execution row from backend deployment skew', async () => {
        const incompatible = executionQueryResult({
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
        });
        mocks.httpQuery.mockResolvedValue(incompatible);
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockReturnValue(incompatible);
        liveClient.callback?.();

        await waitFor(() =>
            expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE')
        );
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:0/2');
        expect(mocks.httpQuery).toHaveBeenCalledOnce();
    });

    it('does not misclassify an unrelated argument validation failure as deployment skew', async () => {
        const invalidRunId = new Error(
            'ArgumentValidationError: Value does not match validator. Path: .runId Value: "invalid" Validator: v.id("structureImportRuns")'
        );
        mocks.httpQuery.mockRejectedValue(invalidRunId);
        renderProgress({ initialExecution: execution(), runId: 'run-1' });

        await waitFor(() => expect(mocks.liveClients).toHaveLength(1));
        const liveClient = mocks.liveClients[0];
        liveClient.localQueryResult.mockImplementation(() => {
            throw invalidRunId;
        });
        liveClient.callback?.();

        await waitFor(() => expect(screen.getByTestId('issue').textContent).toBe('BLUEPRINT_PROGRESS_READ_FAILED'));
        expect(screen.getByTestId('progress').textContent).toBe('run-1:running:0/2');
    });
});

function ProgressProbe({
    initialExecution,
    runId,
}: {
    initialExecution: DashboardStructureExecutionProgress | undefined;
    runId: string | undefined;
}) {
    const progress = useDashboardStructureExecutionProgress({
        guildId: 'guild-1',
        initialExecution,
        runId,
    });
    return (
        <>
            <output data-testid='progress'>
                {progress.execution
                    ? `${progress.execution.id}:${progress.execution.status}:${progress.execution.completedActions}/${progress.execution.totalActions}`
                    : 'none'}
            </output>
            <output data-testid='issue'>{progress.issueCode ?? 'none'}</output>
            <output data-testid='transport'>
                {progress.transport.mode}:{progress.transport.confirmedAt ? 'confirmed' : 'unconfirmed'}
            </output>
            <button type='button' onClick={progress.retry}>
                Retry progress
            </button>
        </>
    );
}

function ProgressProvider({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderProgress({
    initialExecution,
    runId,
}: {
    initialExecution: DashboardStructureExecutionProgress | undefined;
    runId: string | undefined;
}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <ProgressProvider queryClient={queryClient}>
            <ProgressProbe initialExecution={initialExecution} runId={runId} />
        </ProgressProvider>
    );
    unmountViews.push(view.unmount);
    return { ...view, queryClient };
}

function execution(overrides: Partial<DashboardStructureExecutionProgress> = {}): DashboardStructureExecutionProgress {
    return {
        id: 'run-1',
        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        status: 'running',
        phase: 'update',
        completedActions: 0,
        failedActions: 0,
        totalActions: 2,
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}

type ExecutionQueryResult = {
    appliedActions: number;
    completedAt?: string;
    createdAt: string;
    failedActions: number;
    id: string;
    phase: string;
    protocolVersion: number;
    skippedActions: number;
    status: string;
    totalActions: number;
    updatedAt: string;
};

function executionQueryResult(overrides: Partial<ExecutionQueryResult> = {}): ExecutionQueryResult {
    return {
        appliedActions: 0,
        createdAt: '2026-07-11T12:00:00.000Z',
        failedActions: 0,
        id: 'run-1',
        phase: 'update',
        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        skippedActions: 0,
        status: 'running',
        totalActions: 2,
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}

function structureSettingsKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'structure-settings'];
}

function structureProgressKey(guildId: string, runId: string) {
    return ['dashboard', 'guild', guildId, 'structure-execution-progress', runId];
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}
