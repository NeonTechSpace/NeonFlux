import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import { ConvexReactClient } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import { getDashboardGuildCatalogQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildCatalogRouteData } from '../server/dashboard-guild-catalog-route-data.js';
import type { DashboardGuildCatalog } from '../server/dashboard-guild-catalog-route-data.js';
import { useDashboardLiveTransportActive } from './dashboard-live-activity.js';
import { fetchDashboardConvexToken, readDashboardConvexUrl } from './dashboard-live-invalidation.js';

const dashboardGuildCatalogRefreshIntervalMs = 15_000;

type DashboardCatalogLiveState = {
    updatedAt: string;
    version: number;
};

type DashboardCatalogLiveWatch = {
    localQueryResult: () => DashboardCatalogLiveState | undefined;
    onUpdate: (callback: () => void) => () => void;
};

type DashboardCatalogLiveClient = {
    close: () => Promise<void>;
    setAuth: (fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>) => void;
    watchQuery: (
        query: typeof api.dashboard_catalog.readDashboardCatalogState,
        args: Record<string, never>
    ) => DashboardCatalogLiveWatch;
};

export function useDashboardGuildCatalog(initialCatalog: DashboardGuildCatalog | undefined) {
    const queryClient = useQueryClient();
    const [loaderCatalog] = useState(initialCatalog);
    const [initialSeedApplied, setInitialSeedApplied] = useState(initialCatalog === undefined);

    useDashboardGuildCatalogLiveInvalidation(Boolean(loaderCatalog));

    const catalogQuery = useQuery({
        queryKey: getDashboardGuildCatalogQueryKey(),
        queryFn: readDashboardGuildCatalog,
        enabled: Boolean(loaderCatalog),
        ...(loaderCatalog ? { initialData: loaderCatalog } : {}),
        refetchInterval: dashboardGuildCatalogRefreshIntervalMs,
        refetchIntervalInBackground: false,
        refetchOnReconnect: 'always',
        refetchOnWindowFocus: 'always',
        retry: false,
        staleTime: dashboardGuildCatalogRefreshIntervalMs,
    });

    useEffect(() => {
        if (!loaderCatalog || initialSeedApplied) {
            return;
        }

        queryClient.setQueryData(getDashboardGuildCatalogQueryKey(), loaderCatalog);
        let active = true;
        queueMicrotask(() => {
            if (active) {
                setInitialSeedApplied(true);
            }
        });

        return () => {
            active = false;
        };
    }, [initialSeedApplied, loaderCatalog, queryClient]);

    return {
        data: initialSeedApplied ? catalogQuery.data : loaderCatalog,
    };
}

async function readDashboardGuildCatalog(): Promise<DashboardGuildCatalog> {
    const result = await readDashboardGuildCatalogRouteData();

    switch (result.type) {
        case 'catalog':
            return result.catalog;

        case 'auth-required':
            throw new Error('Dashboard authentication is no longer available.');

        case 'unavailable':
            throw new Error('Dashboard server catalog is temporarily unavailable.');
    }
}

function useDashboardGuildCatalogLiveInvalidation(enabled: boolean): void {
    const queryClient = useQueryClient();
    const liveTransportActive = useDashboardLiveTransportActive();
    const previousLiveTransportActiveRef = useRef(liveTransportActive);

    useEffect(() => {
        const becameActive = liveTransportActive && previousLiveTransportActiveRef.current === false;
        previousLiveTransportActiveRef.current = liveTransportActive;

        if (!enabled || typeof window === 'undefined' || !liveTransportActive) {
            return undefined;
        }

        if (becameActive) {
            void queryClient.invalidateQueries({ queryKey: getDashboardGuildCatalogQueryKey() });
        }

        const convexUrl = readDashboardConvexUrl();

        if (!convexUrl) {
            return undefined;
        }

        const client = new ConvexReactClient(convexUrl, { logger: false }) as DashboardCatalogLiveClient;
        let knownSignal: string | undefined;

        client.setAuth(() => fetchDashboardConvexToken());
        const watch = client.watchQuery(api.dashboard_catalog.readDashboardCatalogState, {});

        function handleCatalogStateUpdate(): void {
            let state: DashboardCatalogLiveState | undefined;

            try {
                state = watch.localQueryResult();
            } catch {
                return;
            }

            if (!state) {
                return;
            }

            const signal = `${state.version}:${state.updatedAt}`;

            if (knownSignal !== undefined && knownSignal !== signal) {
                void queryClient.invalidateQueries({ queryKey: getDashboardGuildCatalogQueryKey() });
            }

            knownSignal = signal;
        }

        const unsubscribe = watch.onUpdate(handleCatalogStateUpdate);

        return () => {
            unsubscribe();
            void client.close();
        };
    }, [enabled, liveTransportActive, queryClient]);
}
