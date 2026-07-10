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

export function useDashboardStructureWorkspaceQueries(guildId: string) {
    const queryKey = getDashboardStructureSettingsQueryKey(guildId);
    const [settingsRequestOutstanding, setSettingsRequestOutstanding] = useState(false);
    const settingsRequestRef =
        useRef<Promise<Awaited<ReturnType<typeof readDashboardStructureSettingsRouteData>>>>(undefined);
    // Operational request fencing does not change the guild-scoped query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            if (settingsRequestRef.current) {
                throw new DashboardStructureRequestError('BLUEPRINT_LOAD_REQUEST_IN_FLIGHT');
            }
            const request = readDashboardStructureSettingsRouteData({ data: { guildId } });
            settingsRequestRef.current = request;
            setSettingsRequestOutstanding(true);
            void request
                .finally(() => {
                    if (settingsRequestRef.current === request) {
                        settingsRequestRef.current = undefined;
                        setSettingsRequestOutstanding(false);
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
        retrySettings: () =>
            recoverDashboardStructureSettings({
                requestOutstanding: settingsRequestOutstanding,
                refetch: () => void settingsQuery.refetch(),
            }),
        settingsQuery,
        settingsRequestOutstanding,
    };
}

export function recoverDashboardStructureSettings({
    requestOutstanding,
    refetch,
    reload = () => window.location.reload(),
}: {
    requestOutstanding: boolean;
    refetch: () => void;
    reload?: () => void;
}): void {
    if (requestOutstanding) {
        reload();
        return;
    }
    refetch();
}
