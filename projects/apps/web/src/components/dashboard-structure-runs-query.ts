import { useQuery } from '@tanstack/react-query';

import { getDashboardStructureRunsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardStructureRunsRouteData } from '../server/dashboard-structure-route-data.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';

export function useDashboardStructureRunsQuery(guildId: string) {
    const { readSlice } = useDashboardStructureRuntime();

    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    return useQuery({
        queryKey: getDashboardStructureRunsQueryKey(guildId),
        queryFn: () => readSlice('runs', 'runs', () => readDashboardStructureRunsRouteData({ data: { guildId } })),
        retry: false,
    });
}
