import { useQuery } from '@tanstack/react-query';

import { getDashboardStructureBackupsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardStructureBackupsRouteData } from '../server/dashboard-structure-route-data.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';

export function useDashboardStructureBackupsQuery(guildId: string) {
    const { readSlice } = useDashboardStructureRuntime();

    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    return useQuery({
        queryKey: getDashboardStructureBackupsQueryKey(guildId),
        queryFn: () =>
            readSlice('backups', 'backups', () => readDashboardStructureBackupsRouteData({ data: { guildId } })),
        retry: false,
    });
}
