import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import { useEffect, useRef, useState } from 'react';

import { getDashboardGuildCatalogQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildCatalogRouteData } from '../server/dashboard-guild-catalog-route-data.js';
import type { DashboardGuildCatalog } from '../server/dashboard-guild-catalog-route-data.js';
import { useDashboardLiveTransportActive } from './dashboard-live-activity.js';
import {
    dashboardCatalogRefetchInterval,
    dashboardLiveFallbackRefreshIntervalMs,
    isDashboardLiveHealthy,
    useDashboardLive,
} from './dashboard-live-provider.js';

type DashboardCatalogLiveState = {
    updatedAt: string;
    version: number;
};

export function useDashboardGuildCatalog(initialCatalog: DashboardGuildCatalog | undefined) {
    const queryClient = useQueryClient();
    const { confirmManageableGuildScope, status: liveStatus } = useDashboardLive();
    const liveInvalidationHealthy = isDashboardLiveHealthy(liveStatus);
    const previousLiveInvalidationHealthyRef = useRef(liveInvalidationHealthy);
    const [loaderCatalog] = useState(initialCatalog);
    const [initialSeedApplied, setInitialSeedApplied] = useState(initialCatalog === undefined);

    useDashboardGuildCatalogLiveInvalidation(Boolean(loaderCatalog));

    const catalogQuery = useQuery({
        queryKey: getDashboardGuildCatalogQueryKey(),
        queryFn: readDashboardGuildCatalog,
        enabled: Boolean(loaderCatalog),
        ...(loaderCatalog ? { initialData: loaderCatalog } : {}),
        refetchInterval: dashboardCatalogRefetchInterval(liveStatus),
        refetchIntervalInBackground: false,
        refetchOnReconnect: 'always',
        refetchOnWindowFocus: 'always',
        retry: false,
        staleTime: liveInvalidationHealthy ? Infinity : dashboardLiveFallbackRefreshIntervalMs,
    });

    useEffect(() => {
        const reconnected = liveInvalidationHealthy && previousLiveInvalidationHealthyRef.current === false;
        previousLiveInvalidationHealthyRef.current = liveInvalidationHealthy;
        if (reconnected) void queryClient.invalidateQueries({ queryKey: getDashboardGuildCatalogQueryKey() });
    }, [liveInvalidationHealthy, queryClient]);

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

    const catalog = initialSeedApplied ? catalogQuery.data : loaderCatalog;
    const manageableGuildScope =
        catalog?.guilds
            .map((guild) => guild.id)
            .sort()
            .join(',') ?? '';

    useEffect(() => {
        if (!catalog) return;
        confirmManageableGuildScope(catalog.guilds.map((guild) => guild.id));
    }, [catalog, confirmManageableGuildScope, manageableGuildScope]);

    return {
        data: catalog,
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
    const { client } = useDashboardLive();

    useEffect(() => {
        const becameActive = liveTransportActive && previousLiveTransportActiveRef.current === false;
        previousLiveTransportActiveRef.current = liveTransportActive;

        if (!enabled || typeof window === 'undefined' || !liveTransportActive) {
            return undefined;
        }

        if (becameActive) {
            void queryClient.invalidateQueries({ queryKey: getDashboardGuildCatalogQueryKey() });
        }

        if (!client) return undefined;
        let knownSignal: string | undefined;

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
        };
    }, [client, enabled, liveTransportActive, queryClient]);
}
