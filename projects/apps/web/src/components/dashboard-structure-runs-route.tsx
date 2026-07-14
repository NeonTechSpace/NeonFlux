import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { useDashboardStructureRunInspectionState } from './dashboard-structure-run-inspection-state.js';
import { useDashboardStructureRunOperations } from './dashboard-structure-run-operations.js';
import { useDashboardStructureRunsQuery } from './dashboard-structure-runs-query.js';
import { DashboardStructureRunsSurface } from './dashboard-structure-runs-surface.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';
import {
    DashboardStructurePendingSurface,
    DashboardStructureSurfaceContent,
} from './dashboard-structure-surface-state.js';

export function DashboardStructureRunsRoute() {
    const runtime = useDashboardStructureRuntime();
    const { activeExecutionRun, executionProgress, guildId, retryStatus, setDeployFlow, statusError } = runtime;
    const queryClient = useQueryClient();
    const runsQuery = useDashboardStructureRunsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();

    async function refreshRuns(): Promise<void> {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: getDashboardStructureRunsQueryKey(guildId) }),
            queryClient.invalidateQueries({ queryKey: getDashboardStructureStatusQueryKey(guildId) }),
        ]);
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    const inspection = useDashboardStructureRunInspectionState({ guildId, setBusyAction, setStatus });
    const runOperations = useDashboardStructureRunOperations({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        seedRunActions: inspection.seedRunActions,
        setBusyAction,
        setStatus,
    });

    if (!runsQuery.data && runsQuery.isError) {
        return (
            <DashboardStructurePendingSurface
                surface='runs'
                error={{
                    diagnosticCode: readDashboardStructureDiagnosticCode(runsQuery.error),
                    retry: () => void runsQuery.refetch(),
                    retrying: runsQuery.isFetching,
                }}
            />
        );
    }
    if (!runsQuery.data) return <DashboardStructurePendingSurface surface='runs' />;

    const importRuns = runsQuery.data.importRuns.map((run) => ({
        ...run,
        actions: inspection.actionPagesByRunId[run.id]?.actions ?? run.actions,
        decisions: inspection.decisionPagesByRunId[run.id]?.decisions ?? run.decisions,
        ...(run.id === activeExecutionRun?.id && executionProgress.execution
            ? { execution: executionProgress.execution }
            : {}),
    }));
    const refreshError = runsQuery.isError ? runsQuery.error : statusError;

    return (
        <DashboardStructureSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardStructureDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (runsQuery.isError) void runsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardStructureRunsSurface
                workspace={{
                    busyAction,
                    deleteConfirmationByRunId: runOperations.deleteConfirmationByRunId,
                    executionProgressIssue:
                        executionProgress.issueCode && activeExecutionRun
                            ? { code: executionProgress.issueCode, runId: activeExecutionRun.id }
                            : undefined,
                    executionProgressRetrying: executionProgress.retrying,
                    importRuns,
                    latestRun: importRuns.at(0),
                    preflightByRunId: runOperations.preflightByRunId,
                    onApplyRun: (run) => void runOperations.applyImportRun(run),
                    onApprovePlan: (run) => void runOperations.reviewAndPreflight(run),
                    onControlExecution: (run, request) => void runOperations.controlExecution(run, request),
                    onDeleteConfirmationChange: (runId, confirmation) =>
                        runOperations.setDeleteConfirmationByRunId((current) => ({
                            ...current,
                            [runId]: confirmation,
                        })),
                    onLoadRunActions: (run) => void inspection.loadRunActions(run),
                    onLoadRunDecisions: (run) => void inspection.loadRunDecisions(run),
                    onPreflightRun: (run) => void runOperations.preflightImportRun(run),
                    onRecoveryPlan: (run) => {
                        void (async () => {
                            const recovery = await runOperations.createRecoveryPlan(run);
                            if (recovery) setDeployFlow({ type: 'run', run: recovery });
                        })();
                    },
                    onRetryExecutionProgress: executionProgress.retry,
                }}
            />
        </DashboardStructureSurfaceContent>
    );
}
