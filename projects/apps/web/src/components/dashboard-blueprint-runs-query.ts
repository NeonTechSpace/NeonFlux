import { useQuery } from '@tanstack/react-query';

import { getDashboardBlueprintRunsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardBlueprintRunsRouteData } from '../server/dashboard-blueprint-route-data.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';

export function useDashboardBlueprintRunsQuery(guildId: string) {
    const { readSlice } = useDashboardBlueprintRuntime();

    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    return useQuery({
        queryKey: getDashboardBlueprintRunsQueryKey(guildId),
        queryFn: () => readSlice('runs', 'runs', () => readDashboardBlueprintRunsRouteData({ data: { guildId } })),
        retry: false,
    });
}
