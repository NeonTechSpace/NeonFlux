import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
    getDashboardStructureBackupsQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import {
    readDashboardStructureBackupsRouteData,
    readDashboardStructureRunsRouteData,
    readDashboardStructureStatusRouteData,
} from '../server/dashboard-structure-route-data.js';
import { useDashboardStructureExecutionProgress } from './dashboard-structure-execution-progress.js';
import {
    DashboardStructureRequestError,
    withDashboardStructureRequestTimeout,
} from './dashboard-structure-progress.js';
import type { DashboardStructureSurface } from './dashboard-structure-panel-view.js';

const dashboardStructureRequestTimeoutMs = 12_000;
type StructureRequest = Promise<{ type: string }>;

export function useDashboardStructureWorkspaceQueries(guildId: string, surface: DashboardStructureSurface) {
    const [outstandingRequestKeys, setOutstandingRequestKeys] = useState<ReadonlySet<string>>(() => new Set());
    const requestByKeyRef = useRef(new Map<string, StructureRequest>());
    const needsBackups = surface === 'current' || surface === 'backups' || surface === 'compare';
    const needsRuns = surface === 'compare' || surface === 'deploy' || surface === 'runs';
    const requestKey = (slice: 'backups' | 'runs' | 'status') => `${guildId}:${slice}`;

    function trackRequest<T extends { type: string }>(key: string, request: Promise<T>): Promise<T> {
        if (requestByKeyRef.current.has(key)) {
            throw new DashboardStructureRequestError('BLUEPRINT_LOAD_REQUEST_IN_FLIGHT');
        }
        requestByKeyRef.current.set(key, request);
        setOutstandingRequestKeys((current) => new Set(current).add(key));
        void request
            .finally(() => {
                if (requestByKeyRef.current.get(key) !== request) return;
                requestByKeyRef.current.delete(key);
                setOutstandingRequestKeys((current) => {
                    if (!current.has(key)) return current;
                    const next = new Set(current);
                    next.delete(key);
                    return next;
                });
            })
            .catch(() => undefined);
        return request;
    }

    async function readSlice<T extends { type: string }, TExpected extends T['type']>(
        key: string,
        expectedType: TExpected,
        createRequest: () => Promise<T>
    ): Promise<Extract<T, { type: TExpected }>> {
        if (requestByKeyRef.current.has(key)) {
            throw new DashboardStructureRequestError('BLUEPRINT_LOAD_REQUEST_IN_FLIGHT');
        }
        const result = await withDashboardStructureRequestTimeout(
            trackRequest(key, createRequest()),
            dashboardStructureRequestTimeoutMs
        );
        if (result.type !== expectedType) {
            throw new DashboardStructureRequestError(
                `BLUEPRINT_LOAD_${result.type.replaceAll('-', '_').toUpperCase()}`
            );
        }
        return result as Extract<T, { type: TExpected }>;
    }

    // Operational request fencing is keyed by the full slice identity, not just guild identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const statusQuery = useQuery({
        queryKey: getDashboardStructureStatusQueryKey(guildId),
        queryFn: () =>
            readSlice(requestKey('status'), 'status', () =>
                readDashboardStructureStatusRouteData({ data: { guildId } })
            ),
        retry: false,
    });
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const backupsQuery = useQuery({
        queryKey: getDashboardStructureBackupsQueryKey(guildId),
        queryFn: () =>
            readSlice(requestKey('backups'), 'backups', () =>
                readDashboardStructureBackupsRouteData({ data: { guildId } })
            ),
        enabled: needsBackups,
        retry: false,
    });
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const runsQuery = useQuery({
        queryKey: getDashboardStructureRunsQueryKey(guildId),
        queryFn: () =>
            readSlice(requestKey('runs'), 'runs', () => readDashboardStructureRunsRouteData({ data: { guildId } })),
        enabled: needsRuns,
        retry: false,
    });

    const activeExecutionRun = statusQuery.data?.activeRun;
    const executionProgress = useDashboardStructureExecutionProgress({
        guildId,
        runId: activeExecutionRun?.id,
        initialExecution: activeExecutionRun?.execution,
    });

    function retrySlice(key: 'backups' | 'runs' | 'status'): void {
        if (outstandingRequestKeys.has(requestKey(key))) {
            window.location.reload();
            return;
        }
        if (key === 'backups') void backupsQuery.refetch();
        if (key === 'runs') void runsQuery.refetch();
        if (key === 'status') void statusQuery.refetch();
    }

    return {
        activeExecutionRun,
        backupsQuery,
        executionProgress,
        needsBackups,
        needsRuns,
        retryBackups: () => retrySlice('backups'),
        retryRuns: () => retrySlice('runs'),
        retryStatus: () => retrySlice('status'),
        runsQuery,
        statusQuery,
    };
}
