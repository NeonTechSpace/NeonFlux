import { useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import { ConvexReactClient } from 'convex/react';
import { useEffect, useRef } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardCommandSettingsQueryKey,
    getDashboardOverviewQueryKey,
    getDashboardPostingTemplatesQueryKey,
    getDashboardReactionRolesSettingsQueryKey,
    getDashboardStructureExecutionProgressBaseQueryKey,
    getDashboardStructureSettingsQueryKey,
} from '../dashboard-query-keys.js';
import { createDashboardRequestDeadline } from '../dashboard-request-deadline.js';
import { useDashboardLiveTransportActive } from './dashboard-live-activity.js';

const dashboardConvexTokenTimeoutMs = 8_000;

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
        const knownSignals = new Map<DashboardLiveArea, string>();
        let hasBaseline = false;

        client.setAuth(() => fetchDashboardConvexToken());
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

                const signal = `${state.version}:${state.updatedAt}`;
                const previousSignal = knownSignals.get(state.area);
                knownSignals.set(state.area, signal);

                if (!hasBaseline || (previousSignal !== undefined && previousSignal !== signal)) {
                    changedAreas.push(state.area);
                }
            }

            hasBaseline = true;

            const invalidatedDestinations = new Set<string>();
            for (const area of changedAreas) {
                invalidateDashboardLiveArea(queryClient, guildId, area, invalidatedDestinations);
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

export async function fetchDashboardConvexToken(signal?: AbortSignal): Promise<string | null> {
    const deadline = createDashboardRequestDeadline(signal, dashboardConvexTokenTimeoutMs);

    try {
        const response = await fetch('/auth/convex/token', {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: deadline.signal,
        });

        if (!response.ok) {
            return null;
        }

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

function invalidateVisibleAreas(
    queryClient: ReturnType<typeof useQueryClient>,
    guildId: string,
    visibleAreas: ReadonlySet<DashboardLiveArea>
): void {
    const invalidatedDestinations = new Set<string>();
    for (const area of visibleAreas) {
        invalidateDashboardLiveArea(queryClient, guildId, area, invalidatedDestinations);
    }
}

function invalidateDashboardLiveArea(
    queryClient: ReturnType<typeof useQueryClient>,
    guildId: string,
    area: DashboardLiveArea,
    invalidatedDestinations: Set<string>
): void {
    const invalidateOnce = (destination: string, queryKey: readonly unknown[]) => {
        if (invalidatedDestinations.has(destination)) return;
        invalidatedDestinations.add(destination);
        void queryClient.invalidateQueries({ queryKey });
    };
    const destination = dashboardLiveInvalidationDestination(area);

    switch (area) {
        case 'overview':
            invalidateOnce(destination, getDashboardOverviewQueryKey(guildId));
            return;

        case 'commands':
            invalidateOnce(destination, getDashboardCommandSettingsQueryKey(guildId));
            return;

        case 'reaction_roles':
            invalidateOnce(destination, getDashboardReactionRolesSettingsQueryKey(guildId));
            return;

        case 'posting':
            invalidateOnce(destination, getDashboardPostingTemplatesQueryKey(guildId));
            return;

        case 'import_export':
            invalidateOnce(destination, getDashboardStructureSettingsQueryKey(guildId));
            return;

        case 'structure_execution':
            invalidateOnce(destination, getDashboardStructureExecutionProgressBaseQueryKey(guildId));
            return;

        case 'structure':
            invalidateOnce(destination, getDashboardStructureSettingsQueryKey(guildId));
            return;

        case 'audit':
            invalidateOnce(destination, getDashboardAuditEventsBaseQueryKey(guildId));
            return;
    }
}

export function dashboardLiveInvalidationDestination(area: DashboardLiveArea): string {
    if (area === 'import_export' || area === 'structure') return 'structure-settings';
    if (area === 'structure_execution') return 'structure-execution-progress';
    return area;
}

export function countDashboardLiveInvalidationDestinations(areas: readonly DashboardLiveArea[]): number {
    return new Set(areas.map(dashboardLiveInvalidationDestination)).size;
}
