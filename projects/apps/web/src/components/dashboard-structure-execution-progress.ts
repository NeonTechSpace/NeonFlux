import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { ConvexReactClient } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { getDashboardStructureExecutionProgressQueryKey } from '../dashboard-query-keys.js';
import { dashboardStructureExecutionPhases } from '../server/dashboard-structure-v2.js';
import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-v2.js';
import { fetchDashboardConvexToken, readDashboardConvexUrl } from './dashboard-live-invalidation.js';
import { mergeDashboardStructureExecutionProgress } from './dashboard-structure-progress.js';

const progressWatchTimeoutMs = 12_000;
const executionStatuses = new Set<DashboardStructureExecutionProgress['status']>([
    'queued',
    'running',
    'waiting_rate_limit',
    'pause_requested',
    'paused',
    'verifying',
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
]);

export function useDashboardStructureExecutionProgress({
    guildId,
    runId,
    initialExecution,
}: {
    guildId: string;
    runId: string | undefined;
    initialExecution: DashboardStructureExecutionProgress | undefined;
}) {
    const queryClient = useQueryClient();
    const [watchAttempt, setWatchAttempt] = useState(0);
    const [issueCode, setIssueCode] = useState<string>();
    const convexUrl = readDashboardConvexUrl();
    const queryKey = useMemo(
        () => getDashboardStructureExecutionProgressQueryKey(guildId, runId ?? 'none'),
        [guildId, runId]
    );
    const progressQuery = useQuery({
        queryKey,
        queryFn: () => Promise.resolve(null),
        initialData: initialExecution ?? null,
        enabled: false,
        staleTime: Infinity,
    });

    useEffect(() => {
        if (!runId || !initialExecution) return;
        queryClient.setQueryData<DashboardStructureExecutionProgress | null>(queryKey, (current) =>
            mergeDashboardStructureExecutionProgress(current, initialExecution)
        );
    }, [initialExecution, queryClient, queryKey, runId]);

    useEffect(() => {
        if (!runId || typeof window === 'undefined') return undefined;
        if (!convexUrl) return undefined;

        const client = new ConvexReactClient(convexUrl, { logger: false });
        client.setAuth(fetchDashboardConvexToken);
        const watch = client.watchQuery(api.structure.findStructureImportExecutionProgressForGuild, {
            guildId,
            runId: runId as Id<'structureImportRuns'>,
        });
        let receivedResult = false;
        const timeout = setTimeout(() => {
            if (!receivedResult) setIssueCode('BLUEPRINT_PROGRESS_TIMEOUT');
        }, progressWatchTimeoutMs);

        function readProgress(): void {
            try {
                const result = watch.localQueryResult();
                if (result === undefined) return;
                receivedResult = true;
                clearTimeout(timeout);
                const execution = toDashboardExecutionProgress(result);
                queryClient.setQueryData<DashboardStructureExecutionProgress | null>(queryKey, (current) =>
                    mergeDashboardStructureExecutionProgress(current, execution)
                );
                setIssueCode(undefined);
            } catch {
                setIssueCode('BLUEPRINT_PROGRESS_READ_FAILED');
            }
        }

        const unsubscribe = watch.onUpdate(readProgress);
        readProgress();

        return () => {
            clearTimeout(timeout);
            unsubscribe();
            void client.close();
        };
    }, [convexUrl, guildId, queryClient, queryKey, runId, watchAttempt]);

    return {
        execution: progressQuery.data,
        issueCode: runId && !convexUrl ? 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE' : issueCode,
        retry: () => setWatchAttempt((current) => current + 1),
    };
}

type ExecutionProgressQueryResult = {
    appliedActions: number;
    completedAt?: string;
    createdAt: string;
    currentActionLabel?: string;
    errorType?: string;
    failedActions: number;
    id: string;
    phase: string;
    retryAt?: string;
    skippedActions: number;
    startedAt?: string;
    status: string;
    totalActions: number;
    updatedAt: string;
};

function toDashboardExecutionProgress(
    result: ExecutionProgressQueryResult | null
): DashboardStructureExecutionProgress | null {
    if (!result) return null;
    if (!executionStatuses.has(result.status as DashboardStructureExecutionProgress['status'])) {
        throw new Error('invalid-blueprint-execution-status');
    }
    if (!dashboardStructureExecutionPhases.includes(result.phase as DashboardStructureExecutionProgress['phase'])) {
        throw new Error('invalid-blueprint-execution-phase');
    }

    return {
        id: result.id,
        status: result.status as DashboardStructureExecutionProgress['status'],
        phase: result.phase as DashboardStructureExecutionProgress['phase'],
        completedActions: result.appliedActions + result.failedActions + result.skippedActions,
        failedActions: result.failedActions,
        totalActions: result.totalActions,
        ...(result.currentActionLabel ? { currentActionLabel: result.currentActionLabel } : {}),
        ...(result.retryAt ? { retryAt: result.retryAt } : {}),
        ...(result.errorType ? { errorType: result.errorType } : {}),
        createdAt: result.createdAt,
        ...(result.startedAt ? { startedAt: result.startedAt } : {}),
        updatedAt: result.updatedAt,
        ...(result.completedAt ? { completedAt: result.completedAt } : {}),
    };
}
