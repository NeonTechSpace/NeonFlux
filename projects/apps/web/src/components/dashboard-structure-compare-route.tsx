import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardStructureBackupsQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import { createDashboardStructureBackupCreation } from './dashboard-structure-backup-creation.js';
import { useDashboardStructureBackupsQuery } from './dashboard-structure-backups-query.js';
import { DashboardStructureCompareSurface } from './dashboard-structure-compare-surface.js';
import { createDashboardStructureDriftActions } from './dashboard-structure-drift-actions.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { useDashboardStructureExplorerState } from './dashboard-structure-panel-explorer-state.js';
import type { DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { createDashboardStructureRestorePlan } from './dashboard-structure-restore-plan.js';
import { useDashboardStructureRunInspectionState } from './dashboard-structure-run-inspection-state.js';
import { useDashboardStructureRunsQuery } from './dashboard-structure-runs-query.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';
import {
    DashboardStructurePendingSurface,
    DashboardStructureSurfaceContent,
} from './dashboard-structure-surface-state.js';

export function DashboardStructureCompareRoute() {
    const runtime = useDashboardStructureRuntime();
    const {
        activeExecutionRun,
        comparisonSource,
        executionProgress,
        guildId,
        importJson,
        navigateToSurface,
        retryStatus,
        setComparisonSource,
        setDeployFlow,
        statusError,
    } = runtime;
    const queryClient = useQueryClient();
    const backupsQuery = useDashboardStructureBackupsQuery(guildId);
    const runsQuery = useDashboardStructureRunsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();

    async function refreshBackups(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardStructureBackupsQueryKey(guildId) });
    }

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
    const explorer = useDashboardStructureExplorerState({
        driftState,
        guildId,
        importJson,
        initialSource: comparisonSource,
        onSourceChange: setComparisonSource,
        setBusyAction,
        setStatus,
    });
    const createBackup = createDashboardStructureBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBusyAction,
        setStatus,
    });
    const createRestorePlan = createDashboardStructureRestorePlan({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        seedRunActions: inspection.seedRunActions,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardStructureDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

    const coldErrorQuery = [backupsQuery, runsQuery].find((query) => !query.data && query.isError);
    if (coldErrorQuery) {
        return (
            <DashboardStructurePendingSurface
                surface='compare'
                error={{
                    diagnosticCode: readDashboardStructureDiagnosticCode(coldErrorQuery.error),
                    retry: () => {
                        if (!backupsQuery.data) void backupsQuery.refetch();
                        if (!runsQuery.data) void runsQuery.refetch();
                    },
                    retrying: coldErrorQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data || !runsQuery.data) return <DashboardStructurePendingSurface surface='compare' />;

    const importRuns = runsQuery.data.importRuns.map((run) => ({
        ...run,
        actions: inspection.actionPagesByRunId[run.id]?.actions ?? run.actions,
        ...(run.id === activeExecutionRun?.id && executionProgress.execution
            ? { execution: executionProgress.execution }
            : {}),
    }));
    const refreshError = backupsQuery.isError ? backupsQuery.error : runsQuery.isError ? runsQuery.error : statusError;

    return (
        <DashboardStructureSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardStructureDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (runsQuery.isError) void runsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardStructureCompareSurface
                workspace={{
                    backupSettings: backupsQuery.data.backupSettings,
                    busyAction,
                    driftState,
                    explorer,
                    importRuns,
                    preflightByRunId: {},
                    onCheckLatestDrift: () => void driftActions.check(),
                    onCreateBackup: () => void createBackup(),
                    onCreateRestoreDryRun: (backupId) => {
                        void (async () => {
                            const run = await createRestorePlan({ backupId, intent: 'restore' });
                            if (!run) return;
                            setDeployFlow({ type: 'run', run });
                            await navigateToSurface('deploy');
                        })();
                    },
                    onLoadRunActions: (run) => void inspection.loadRunActions(run),
                    onReviewScheduledDrift: (baselineBackupId) => void driftActions.reviewScheduled(baselineBackupId),
                }}
            />
        </DashboardStructureSurfaceContent>
    );
}
