import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { getDashboardStructureSettingsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardStructureSettingsRouteData } from '../server/dashboard-structure-route-data.js';
import { useDashboardStructureExecutionProgress } from './dashboard-structure-execution-progress.js';
import {
    DashboardStructureRequestError,
    isTerminalDashboardStructureExecution,
    withDashboardStructureRequestTimeout,
} from './dashboard-structure-progress.js';

const dashboardStructureRequestTimeoutMs = 12_000;
type DashboardStructureSettingsRequest = Promise<Awaited<ReturnType<typeof readDashboardStructureSettingsRouteData>>>;

export function useDashboardStructureWorkspaceQueries(guildId: string) {
    const queryKey = getDashboardStructureSettingsQueryKey(guildId);
    const [settingsRequestGuildIds, setSettingsRequestGuildIds] = useState<ReadonlySet<string>>(() => new Set());
    const settingsRequestByGuildIdRef = useRef(new Map<string, DashboardStructureSettingsRequest>());
    // Operational request fencing does not change the guild-scoped query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            if (settingsRequestByGuildIdRef.current.has(guildId)) {
                throw new DashboardStructureRequestError('BLUEPRINT_LOAD_REQUEST_IN_FLIGHT');
            }
            const request = readDashboardStructureSettingsRouteData({ data: { guildId } });
            settingsRequestByGuildIdRef.current.set(guildId, request);
            setSettingsRequestGuildIds((current) => new Set(current).add(guildId));
            void request
                .finally(() => {
                    if (settingsRequestByGuildIdRef.current.get(guildId) === request) {
                        settingsRequestByGuildIdRef.current.delete(guildId);
                        setSettingsRequestGuildIds((current) => {
                            if (!current.has(guildId)) return current;
                            const next = new Set(current);
                            next.delete(guildId);
                            return next;
                        });
                    }
                })
                .catch(() => undefined);
            const result = await withDashboardStructureRequestTimeout(request, dashboardStructureRequestTimeoutMs);

            if (result.type !== 'settings') {
                throw new DashboardStructureRequestError(
                    `BLUEPRINT_LOAD_${result.type.replaceAll('-', '_').toUpperCase()}`
                );
            }

            return result;
        },
        retry: false,
    });
    const activeExecutionRun = settingsQuery.data?.importRuns.find(
        (run) => run.execution && !isTerminalDashboardStructureExecution(run.execution)
    );
    const executionProgress = useDashboardStructureExecutionProgress({
        guildId,
        runId: activeExecutionRun?.id,
        initialExecution: activeExecutionRun?.execution,
    });

    return {
        activeExecutionRun,
        executionProgress,
        queryKey,
        retrySettings: () => {
            if (settingsRequestGuildIds.has(guildId)) {
                window.location.reload();
                return;
            }

            void settingsQuery.refetch();
        },
        settingsQuery,
        settingsRequestOutstanding: settingsRequestGuildIds.has(guildId),
    };
}
