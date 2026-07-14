import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintBackupsQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import { createDashboardBlueprintBackupCreation } from './dashboard-blueprint-backup-creation.js';
import { useDashboardBlueprintBackupsQuery } from './dashboard-blueprint-backups-query.js';
import { DashboardBlueprintCompareSurface } from './dashboard-blueprint-compare-surface.js';
import { createDashboardBlueprintDriftActions } from './dashboard-blueprint-drift-actions.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { useDashboardBlueprintExplorerState } from './dashboard-blueprint-panel-explorer-state.js';
import type { DriftState, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { readDashboardBlueprintDiagnosticCode } from './dashboard-blueprint-progress.js';
import { createDashboardBlueprintRestorePlan } from './dashboard-blueprint-restore-plan.js';
import { useDashboardBlueprintPlanInspectionState } from './dashboard-blueprint-plan-inspection-state.js';
import { useDashboardBlueprintRunsQuery } from './dashboard-blueprint-runs-query.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';
import {
    DashboardBlueprintPendingSurface,
    DashboardBlueprintSurfaceContent,
} from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintCompareRoute() {
    const runtime = useDashboardBlueprintRuntime();
    const {
        activePlan,
        comparisonSource,
        runProgress,
        guildId,
        importJson,
        navigateToSurface,
        retryStatus,
        setComparisonSource,
        setDeployFlow,
        statusError,
    } = runtime;
    const queryClient = useQueryClient();
    const backupsQuery = useDashboardBlueprintBackupsQuery(guildId);
    const runsQuery = useDashboardBlueprintRunsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<BlueprintBusyAction | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();

    async function refreshBackups(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardBlueprintBackupsQueryKey(guildId) });
    }

    async function refreshRuns(): Promise<void> {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: getDashboardBlueprintRunsQueryKey(guildId) }),
            queryClient.invalidateQueries({ queryKey: getDashboardBlueprintStatusQueryKey(guildId) }),
        ]);
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    const inspection = useDashboardBlueprintPlanInspectionState({ guildId, setBusyAction, setStatus });
    const explorer = useDashboardBlueprintExplorerState({
        driftState,
        guildId,
        importJson,
        initialSource: comparisonSource,
        onSourceChange: setComparisonSource,
        setBusyAction,
        setStatus,
    });
    const createBackup = createDashboardBlueprintBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBusyAction,
        setStatus,
    });
    const createRestorePlan = createDashboardBlueprintRestorePlan({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        seedPlanSteps: inspection.seedPlanSteps,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardBlueprintDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

    const coldErrorQuery = [backupsQuery, runsQuery].find((query) => !query.data && query.isError);
    if (coldErrorQuery) {
        return (
            <DashboardBlueprintPendingSurface
                surface='compare'
                error={{
                    diagnosticCode: readDashboardBlueprintDiagnosticCode(coldErrorQuery.error),
                    retry: () => {
                        if (!backupsQuery.data) void backupsQuery.refetch();
                        if (!runsQuery.data) void runsQuery.refetch();
                    },
                    retrying: coldErrorQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data || !runsQuery.data) return <DashboardBlueprintPendingSurface surface='compare' />;

    const plans = runsQuery.data.plans.map((plan) => ({
        ...plan,
        steps: inspection.stepPagesByPlanId[plan.id]?.steps ?? plan.steps,
        ...(plan.id === activePlan?.id && runProgress.run ? { run: runProgress.run } : {}),
    }));
    const refreshError = backupsQuery.isError ? backupsQuery.error : runsQuery.isError ? runsQuery.error : statusError;

    return (
        <DashboardBlueprintSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (runsQuery.isError) void runsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintCompareSurface
                workspace={{
                    backupSettings: backupsQuery.data.backupSettings,
                    busyAction,
                    driftState,
                    explorer,
                    plans,
                    preflightByPlanId: {},
                    onCheckLatestDrift: () => void driftActions.check(),
                    onCreateBackup: () => void createBackup(),
                    onCreateRestorePlan: (backupId) => {
                        void (async () => {
                            const plan = await createRestorePlan({ backupId, intent: 'restore' });
                            if (!plan) return;
                            setDeployFlow({ type: 'plan', plan });
                            await navigateToSurface('deploy');
                        })();
                    },
                    onLoadPlanSteps: (plan) => void inspection.loadPlanSteps(plan),
                    onReviewScheduledDrift: (baselineBackupId) => void driftActions.reviewScheduled(baselineBackupId),
                }}
            />
        </DashboardBlueprintSurfaceContent>
    );
}
