// @vitest-environment jsdom

import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { act, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../dashboard-blueprint-run-protocol.js';
import {
    dashboardCatalogRefetchInterval,
    dashboardPostingOperationRefetchInterval,
    DashboardLiveProvider,
    useDashboardLive,
} from './dashboard-live-provider.js';

type MockConnectionState = {
    connectionCount: number;
    connectionRetries: number;
    hasEverConnected: boolean;
    hasInflightRequests: boolean;
    inflightActions: number;
    inflightMutations: number;
    isWebSocketConnected: boolean;
    timeOfOldestInflightRequest: Date | null;
};

type MockLiveClient = {
    authChange?: (isAuthenticated: boolean) => void;
    authRefreshChange?: (isRefreshing: boolean) => void;
    close: ReturnType<typeof vi.fn>;
    connectionChange?: (state: MockConnectionState) => void;
    connectionState: ReturnType<typeof vi.fn>;
    connectionUnsubscribe: ReturnType<typeof vi.fn>;
    setAuth: ReturnType<typeof vi.fn>;
    subscribeToConnectionState: ReturnType<typeof vi.fn>;
    watchQuery: ReturnType<typeof vi.fn>;
};

const convexMock = vi.hoisted(() => ({
    clients: [] as MockLiveClient[],
    construct: vi.fn(),
}));

vi.mock('convex/react', () => ({
    ConvexReactClient: convexMock.construct,
}));

describe('DashboardLiveProvider', () => {
    it('suppresses fallback polling only while authenticated live invalidation is connected', () => {
        const connected = { authentication: 'authenticated', generation: 1, phase: 'connected' } as const;
        const reconnecting = { authentication: 'authenticated', generation: 1, phase: 'reconnecting' } as const;

        expect(dashboardCatalogRefetchInterval(connected)).toBe(false);
        expect(dashboardCatalogRefetchInterval(reconnecting)).toBe(60_000);
        expect(dashboardPostingOperationRefetchInterval(connected, true)).toBe(false);
        expect(dashboardPostingOperationRefetchInterval(reconnecting, false)).toBe(false);
        expect(dashboardPostingOperationRefetchInterval(reconnecting, true)).toBe(2_000);
    });

    beforeEach(() => {
        setDocumentVisibility('visible');
        setNavigatorOnline(true);
        window.dispatchEvent(new Event('pageshow'));
        vi.stubEnv('VITE_CONVEX_URL', 'https://neonflux.convex.cloud');
        convexMock.clients.length = 0;
        convexMock.construct.mockReset().mockImplementation(function MockConvexReactClient() {
            const connection = connectedState();
            const client: MockLiveClient = {
                close: vi.fn().mockResolvedValue(undefined),
                connectionState: vi.fn(() => connection),
                connectionUnsubscribe: vi.fn(),
                setAuth: vi.fn(
                    (
                        _fetchToken: unknown,
                        onAuthChange?: (isAuthenticated: boolean) => void,
                        onRefreshChange?: (isRefreshing: boolean) => void
                    ) => {
                        client.authChange = onAuthChange;
                        client.authRefreshChange = onRefreshChange;
                    }
                ),
                subscribeToConnectionState: vi.fn((callback: (state: MockConnectionState) => void) => {
                    client.connectionChange = callback;
                    return client.connectionUnsubscribe;
                }),
                watchQuery: vi.fn(() => ({
                    localQueryResult: () => undefined,
                    onUpdate: () => vi.fn(),
                })),
            };
            convexMock.clients.push(client);
            return client;
        });
    });

    afterEach(() => {
        setDocumentVisibility('visible');
        setNavigatorOnline(true);
        window.dispatchEvent(new Event('pageshow'));
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('shares one client across concurrent watches and preserves it when route children change', async () => {
        const view = render(
            <DashboardLiveProvider>
                <CatalogWatch />
                <AreaWatch guildId='guild-1' />
                <ProgressWatch />
            </DashboardLiveProvider>
        );

        await waitFor(() => expect(convexMock.clients).toHaveLength(1));
        const client = convexMock.clients[0];
        await waitFor(() => expect(client.watchQuery).toHaveBeenCalledTimes(3));

        view.rerender(
            <DashboardLiveProvider>
                <CatalogWatch />
                <AreaWatch guildId='guild-2' />
                <ProgressWatch />
            </DashboardLiveProvider>
        );

        await waitFor(() => expect(client.watchQuery).toHaveBeenCalledTimes(4));
        expect(convexMock.clients).toHaveLength(1);
        expect(client.close).not.toHaveBeenCalled();
        expect(screen.getByTestId('live-status').textContent).toBe('connected:unknown:1');

        act(() => client.authChange?.(true));
        expect(screen.getByTestId('live-status').textContent).toBe('connected:authenticated:1');
        view.unmount();
    });

    it('closes while hidden or offline, recreates on resume, and cleans up the exact active client', async () => {
        const view = render(
            <DashboardLiveProvider>
                <LiveStatus />
            </DashboardLiveProvider>
        );
        await waitFor(() => expect(convexMock.clients).toHaveLength(1));
        const firstClient = convexMock.clients[0];

        setDocumentVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(() => expect(firstClient.close).toHaveBeenCalledOnce());
        expect(firstClient.connectionUnsubscribe).toHaveBeenCalledOnce();
        expect(screen.getByTestId('live-status').textContent).toBe('paused:unknown:1');

        setDocumentVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(() => expect(convexMock.clients).toHaveLength(2));
        const secondClient = convexMock.clients[1];
        expect(firstClient.close).toHaveBeenCalledOnce();

        act(() => {
            firstClient.authChange?.(false);
            firstClient.connectionChange?.({ ...connectedState(), isWebSocketConnected: false });
        });
        expect(screen.getByTestId('live-status').textContent).toBe('connected:unknown:2');

        setNavigatorOnline(false);
        window.dispatchEvent(new Event('offline'));
        await waitFor(() => expect(secondClient.close).toHaveBeenCalledOnce());

        setNavigatorOnline(true);
        window.dispatchEvent(new Event('online'));
        await waitFor(() => expect(convexMock.clients).toHaveLength(3));
        const thirdClient = convexMock.clients[2];

        view.unmount();
        expect(thirdClient.close).toHaveBeenCalledOnce();
        expect(firstClient.close).toHaveBeenCalledOnce();
        expect(secondClient.close).toHaveBeenCalledOnce();
    });

    it('restarts only when the confirmed manageable guild id scope changes', async () => {
        const view = render(
            <DashboardLiveProvider>
                <GuildScope guildIds={['guild-1']} displayRevision={1} />
            </DashboardLiveProvider>
        );
        await waitFor(() => expect(convexMock.clients).toHaveLength(1));
        const firstClient = convexMock.clients[0];

        view.rerender(
            <DashboardLiveProvider>
                <GuildScope guildIds={['guild-1']} displayRevision={2} />
            </DashboardLiveProvider>
        );
        await act(async () => undefined);
        expect(convexMock.clients).toHaveLength(1);
        expect(firstClient.close).not.toHaveBeenCalled();

        view.rerender(
            <DashboardLiveProvider>
                <GuildScope guildIds={['guild-2', 'guild-1']} displayRevision={3} />
            </DashboardLiveProvider>
        );
        await waitFor(() => expect(convexMock.clients).toHaveLength(2));
        expect(firstClient.close).toHaveBeenCalledOnce();

        const secondClient = convexMock.clients[1];
        view.rerender(
            <DashboardLiveProvider>
                <GuildScope guildIds={['guild-1', 'guild-2']} displayRevision={4} />
            </DashboardLiveProvider>
        );
        await act(async () => undefined);
        expect(convexMock.clients).toHaveLength(2);
        expect(secondClient.close).not.toHaveBeenCalled();
        view.unmount();
    });

    it('renders deterministic server context without constructing a browser client', () => {
        const view = renderToString(
            <DashboardLiveProvider>
                <LiveStatus />
            </DashboardLiveProvider>
        );

        expect(view).toContain('paused');
        expect(view).toContain('unknown');
        expect(view).toContain('0');
        expect(convexMock.construct).not.toHaveBeenCalled();
    });
});

function CatalogWatch() {
    const { client } = useDashboardLive();

    useEffect(() => {
        if (!client) return undefined;
        const watch = client.watchQuery(api.dashboard_catalog.readDashboardCatalogState, {});
        return watch.onUpdate(() => undefined);
    }, [client]);

    return <LiveStatus />;
}

function AreaWatch({ guildId }: { guildId: string }) {
    const { client } = useDashboardLive();

    useEffect(() => {
        if (!client) return undefined;
        const watch = client.watchQuery(api.dashboard_live.listDashboardLiveStates, {
            areas: ['audit'],
            guildId,
        });
        return watch.onUpdate(() => undefined);
    }, [client, guildId]);

    return null;
}

function ProgressWatch() {
    const { client } = useDashboardLive();

    useEffect(() => {
        if (!client) return undefined;
        const watch = client.watchQuery(api.blueprint.findBlueprintRunProgressForGuild, {
            guildId: 'guild-1',
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            planId: 'plan-1' as Id<'blueprintPlans'>,
        });
        return watch.onUpdate(() => undefined);
    }, [client]);

    return null;
}

function GuildScope({ guildIds, displayRevision }: { guildIds: readonly string[]; displayRevision: number }) {
    const { confirmManageableGuildScope } = useDashboardLive();
    const signature = guildIds.join(',');

    useEffect(() => {
        confirmManageableGuildScope(guildIds);
    }, [confirmManageableGuildScope, displayRevision, guildIds, signature]);

    return null;
}

function LiveStatus() {
    const { status } = useDashboardLive();
    return (
        <output data-testid='live-status'>
            {status.phase}:{status.authentication}:{status.generation}
        </output>
    );
}

function connectedState(): MockConnectionState {
    return {
        connectionCount: 1,
        connectionRetries: 0,
        hasEverConnected: true,
        hasInflightRequests: false,
        inflightActions: 0,
        inflightMutations: 0,
        isWebSocketConnected: true,
        timeOfOldestInflightRequest: null,
    };
}

function setDocumentVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value,
    });
}

function setNavigatorOnline(value: boolean): void {
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value,
    });
}
