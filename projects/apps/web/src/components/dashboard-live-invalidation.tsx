import { useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import { ConvexReactClient } from 'convex/react';
import { useEffect, useRef } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import {
    getDashboardAuditEventsQueryKey,
    getDashboardCommandSettingsQueryKey,
    getDashboardOverviewQueryKey,
    getDashboardPostingTemplatesQueryKey,
    getDashboardReactionRolesSettingsQueryKey,
    getDashboardStructureSettingsQueryKey,
} from '../dashboard-query-keys.js';
import { useDashboardLiveTransportActive } from './dashboard-live-activity.js';

type DashboardLiveState = {
    area: DashboardLiveArea;
    guildId: string;
    updatedAt: string;
    version: number;
};

type DashboardLiveWatch = {
    localQueryResult: () => DashboardLiveState[] | undefined;
    onUpdate: (callback: () => void) => () => void;
};

type DashboardLiveClient = {
    close: () => Promise<void>;
    setAuth: (
        fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>,
        onChange?: (isAuthenticated: boolean) => void,
        onRefreshChange?: (isRefreshing: boolean) => void
    ) => void;
    watchQuery: (
        query: DashboardLiveQueryReference,
        args: { areas: DashboardLiveArea[]; guildId: string }
    ) => DashboardLiveWatch;
};

type DashboardLiveQueryReference = typeof api.dashboard_live.listDashboardLiveStates;

export function useDashboardLiveInvalidation({
    guildId,
    areas,
}: {
    guildId: string;
    areas: readonly DashboardLiveArea[];
}) {
    const queryClient = useQueryClient();
    const areaKey = areas.join(',');
    const liveTransportActive = useDashboardLiveTransportActive();
    const previousLiveTransportActiveRef = useRef(liveTransportActive);

    useEffect(() => {
        const becameActive = liveTransportActive && previousLiveTransportActiveRef.current === false;
        previousLiveTransportActiveRef.current = liveTransportActive;

        if (typeof window === 'undefined' || areas.length === 0 || !liveTransportActive) {
            return undefined;
        }

        const visibleAreas = new Set(areas);
        const convexUrl = readDashboardConvexUrl();

        if (!convexUrl) {
            if (becameActive) {
                invalidateVisibleAreas(queryClient, guildId, visibleAreas);
            }

            return undefined;
        }

        const client = createDashboardLiveClient(convexUrl);
        const knownVersions = new Map<DashboardLiveArea, number>();
        let hasBaseline = false;

        client.setAuth(fetchDashboardConvexToken);
        const watch = client.watchQuery(api.dashboard_live.listDashboardLiveStates, {
            areas: [...visibleAreas],
            guildId,
        });

        function handleLiveStateUpdate(): void {
            let states: DashboardLiveState[] | undefined;

            try {
                states = watch.localQueryResult();
            } catch {
                return;
            }

            if (!states) {
                return;
            }

            const changedAreas: DashboardLiveArea[] = [];

            for (const state of states) {
                if (state.guildId !== guildId || !visibleAreas.has(state.area)) {
                    continue;
                }

                const previousVersion = knownVersions.get(state.area);
                knownVersions.set(state.area, state.version);

                if (hasBaseline && previousVersion !== undefined && previousVersion !== state.version) {
                    changedAreas.push(state.area);
                }
            }

            hasBaseline = true;

            for (const area of changedAreas) {
                invalidateDashboardLiveArea(queryClient, guildId, area);
            }
        }

        if (becameActive) {
            invalidateVisibleAreas(queryClient, guildId, visibleAreas);
        }

        const unsubscribe = watch.onUpdate(handleLiveStateUpdate);

        return () => {
            unsubscribe();
            void client.close();
        };
    }, [areaKey, areas, guildId, liveTransportActive, queryClient]);
}

function createDashboardLiveClient(url: string): DashboardLiveClient {
    return new ConvexReactClient(url, {
        logger: false,
    });
}

async function fetchDashboardConvexToken(): Promise<string | null> {
    const response = await fetch('/auth/convex/token', {
        cache: 'no-store',
        credentials: 'same-origin',
    });

    if (!response.ok) {
        return null;
    }

    const body = (await response.json()) as { token?: unknown };
    return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
}

function readDashboardConvexUrl(): string | undefined {
    const value = import.meta.env.VITE_CONVEX_URL;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function invalidateVisibleAreas(
    queryClient: ReturnType<typeof useQueryClient>,
    guildId: string,
    visibleAreas: ReadonlySet<DashboardLiveArea>
): void {
    for (const area of visibleAreas) {
        invalidateDashboardLiveArea(queryClient, guildId, area);
    }
}

function invalidateDashboardLiveArea(
    queryClient: ReturnType<typeof useQueryClient>,
    guildId: string,
    area: DashboardLiveArea
): void {
    switch (area) {
        case 'overview':
            void queryClient.invalidateQueries({
                queryKey: getDashboardOverviewQueryKey(guildId),
            });
            return;

        case 'commands':
            void queryClient.invalidateQueries({
                queryKey: getDashboardCommandSettingsQueryKey(guildId),
            });
            return;

        case 'reaction_roles':
            void queryClient.invalidateQueries({
                queryKey: getDashboardReactionRolesSettingsQueryKey(guildId),
            });
            return;

        case 'posting':
            void queryClient.invalidateQueries({
                queryKey: getDashboardPostingTemplatesQueryKey(guildId),
            });
            return;

        case 'import_export':
        case 'structure':
            void queryClient.invalidateQueries({
                queryKey: getDashboardStructureSettingsQueryKey(guildId),
            });
            return;

        case 'audit':
            void queryClient.invalidateQueries({
                queryKey: getDashboardAuditEventsQueryKey(guildId),
            });
            return;
    }
}
