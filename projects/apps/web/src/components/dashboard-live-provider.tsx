import { ConvexReactClient } from 'convex/react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { createDashboardRequestDeadline } from '../dashboard-request-deadline.js';
import { useDashboardLiveTransportActive } from './dashboard-live-activity.js';

const dashboardConvexTokenTimeoutMs = 8_000;
export const dashboardLiveFallbackRefreshIntervalMs = 60_000;

export type DashboardLiveStatus = {
    authentication: 'unknown' | 'refreshing' | 'authenticated' | 'unauthenticated';
    generation: number;
    phase: 'paused' | 'unavailable' | 'connecting' | 'connected' | 'reconnecting' | 'restarting';
};

type DashboardLiveContextValue = {
    client: ConvexReactClient | undefined;
    confirmManageableGuildScope: (guildIds: readonly string[]) => void;
    restart: () => void;
    status: DashboardLiveStatus;
};

type DashboardLiveClientState = {
    authentication: DashboardLiveStatus['authentication'];
    client: ConvexReactClient | undefined;
    connection: ReturnType<ConvexReactClient['connectionState']> | undefined;
    generation: number;
    restarting: boolean;
};

const dormantContext: DashboardLiveContextValue = {
    client: undefined,
    confirmManageableGuildScope: () => undefined,
    restart: () => undefined,
    status: {
        authentication: 'unknown',
        generation: 0,
        phase: 'paused',
    },
};

const DashboardLiveContext = createContext<DashboardLiveContextValue>(dormantContext);

export function DashboardLiveProvider({ children }: { children: ReactNode }) {
    const liveTransportActive = useDashboardLiveTransportActive();
    const convexUrl = readDashboardConvexUrl();
    const clientGenerationRef = useRef(0);
    const confirmedGuildScopeRef = useRef<string | undefined>(undefined);
    const [restartRevision, setRestartRevision] = useState(0);
    const [clientState, setClientState] = useState<DashboardLiveClientState>({
        authentication: 'unknown',
        client: undefined,
        connection: undefined,
        generation: 0,
        restarting: false,
    });

    const restart = useCallback(() => {
        setClientState((current) => (current.client ? { ...current, restarting: true } : current));
        setRestartRevision((current) => current + 1);
    }, []);

    const confirmManageableGuildScope = useCallback(
        (guildIds: readonly string[]) => {
            const signature = createManageableGuildScopeSignature(guildIds);
            const previousSignature = confirmedGuildScopeRef.current;
            confirmedGuildScopeRef.current = signature;

            if (previousSignature !== undefined && previousSignature !== signature) {
                restart();
            }
        },
        [restart]
    );

    useEffect(() => {
        if (!convexUrl || !liveTransportActive || typeof window === 'undefined') return undefined;

        const generation = clientGenerationRef.current + 1;
        clientGenerationRef.current = generation;
        const client = new ConvexReactClient(convexUrl, { logger: false });
        let active = true;
        let authentication: DashboardLiveStatus['authentication'] = 'unknown';
        let connection = client.connectionState();

        function publishState(): void {
            if (!active) return;
            setClientState((current) => {
                if (current.generation > generation) return current;
                return {
                    authentication,
                    client,
                    connection,
                    generation,
                    restarting: false,
                };
            });
        }

        client.setAuth(
            () => fetchDashboardConvexToken(),
            (isAuthenticated) => {
                authentication = isAuthenticated ? 'authenticated' : 'unauthenticated';
                publishState();
            },
            (isRefreshing) => {
                if (isRefreshing) {
                    authentication = 'refreshing';
                } else if (authentication === 'refreshing') {
                    authentication = 'unknown';
                }
                publishState();
            }
        );
        const unsubscribeConnection = client.subscribeToConnectionState((nextConnection) => {
            connection = nextConnection;
            publishState();
        });
        publishState();

        return () => {
            active = false;
            unsubscribeConnection();
            setClientState((current) =>
                current.client === client
                    ? {
                          authentication: 'unknown',
                          client: undefined,
                          connection: undefined,
                          generation: current.generation,
                          restarting: false,
                      }
                    : current
            );
            void client.close();
        };
    }, [convexUrl, liveTransportActive, restartRevision]);

    const contextValue = useMemo<DashboardLiveContextValue>(() => {
        if (!convexUrl) {
            return {
                client: undefined,
                confirmManageableGuildScope,
                restart,
                status: {
                    authentication: 'unknown',
                    generation: clientState.generation,
                    phase: 'unavailable',
                },
            };
        }

        if (!liveTransportActive) {
            return {
                client: undefined,
                confirmManageableGuildScope,
                restart,
                status: {
                    authentication: 'unknown',
                    generation: clientState.generation,
                    phase: 'paused',
                },
            };
        }

        return {
            client: clientState.client,
            confirmManageableGuildScope,
            restart,
            status: {
                authentication: clientState.authentication,
                generation: clientState.generation,
                phase: readDashboardLivePhase(clientState),
            },
        };
    }, [clientState, confirmManageableGuildScope, convexUrl, liveTransportActive, restart]);

    return <DashboardLiveContext value={contextValue}>{children}</DashboardLiveContext>;
}

export function useDashboardLive(): DashboardLiveContextValue {
    return use(DashboardLiveContext);
}

export function isDashboardLiveHealthy(status: DashboardLiveStatus): boolean {
    return status.authentication === 'authenticated' && status.phase === 'connected';
}

export function dashboardCatalogRefetchInterval(status: DashboardLiveStatus): number | false {
    return isDashboardLiveHealthy(status) ? false : dashboardLiveFallbackRefreshIntervalMs;
}

export function dashboardPostingOperationRefetchInterval(
    status: DashboardLiveStatus,
    hasActiveOperation: boolean
): number | false {
    return !isDashboardLiveHealthy(status) && hasActiveOperation ? 2_000 : false;
}

export async function fetchDashboardConvexToken(signal?: AbortSignal): Promise<string | null> {
    const deadline = createDashboardRequestDeadline(signal, dashboardConvexTokenTimeoutMs);

    try {
        const response = await fetch('/auth/convex/token', {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: deadline.signal,
        });

        if (!response.ok) return null;

        const body = (await response.json()) as { token?: unknown };
        return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
    } finally {
        deadline.dispose();
    }
}

export function readDashboardConvexUrl(): string | undefined {
    const value = import.meta.env.VITE_CONVEX_URL;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function createManageableGuildScopeSignature(guildIds: readonly string[]): string {
    return [...new Set(guildIds.map((guildId) => guildId.trim()).filter(Boolean))].sort().join(',');
}

function readDashboardLivePhase(state: DashboardLiveClientState): DashboardLiveStatus['phase'] {
    if (state.restarting) return 'restarting';
    if (state.connection?.isWebSocketConnected) return 'connected';
    if (state.connection?.hasEverConnected) return 'reconnecting';
    return 'connecting';
}
