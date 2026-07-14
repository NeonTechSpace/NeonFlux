import { useQuery } from '@tanstack/react-query';

import { getDashboardBlueprintBackupsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardBlueprintBackupsRouteData } from '../server/dashboard-blueprint-route-data.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';

export function useDashboardBlueprintBackupsQuery(guildId: string) {
    const { readSlice } = useDashboardBlueprintRuntime();

    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    return useQuery({
        queryKey: getDashboardBlueprintBackupsQueryKey(guildId),
        queryFn: () =>
            readSlice('backups', 'backups', () => readDashboardBlueprintBackupsRouteData({ data: { guildId } })),
        retry: false,
    });
}
