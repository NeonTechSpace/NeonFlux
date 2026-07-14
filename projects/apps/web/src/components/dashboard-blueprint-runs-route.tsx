import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';
import { readDashboardBlueprintDiagnosticCode } from './dashboard-blueprint-progress.js';
import { useDashboardBlueprintPlanInspectionState } from './dashboard-blueprint-plan-inspection-state.js';
import { useDashboardBlueprintRunOperations } from './dashboard-blueprint-run-operations.js';
import { useDashboardBlueprintRunsQuery } from './dashboard-blueprint-runs-query.js';
import { DashboardBlueprintRunsSurface } from './dashboard-blueprint-runs-surface.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';
import {
    DashboardBlueprintPendingSurface,
    DashboardBlueprintSurfaceContent,
} from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintRunsRoute() {
    const runtime = useDashboardBlueprintRuntime();
    const { activePlan, runProgress, guildId, retryStatus, setDeployFlow, statusError } = runtime;
    const queryClient = useQueryClient();
    const runsQuery = useDashboardBlueprintRunsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<BlueprintBusyAction | undefined>();

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
    const runOperations = useDashboardBlueprintRunOperations({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        seedPlanSteps: inspection.seedPlanSteps,
        setBusyAction,
        setStatus,
    });

    if (!runsQuery.data && runsQuery.isError) {
        return (
            <DashboardBlueprintPendingSurface
                surface='runs'
                error={{
                    diagnosticCode: readDashboardBlueprintDiagnosticCode(runsQuery.error),
                    retry: () => void runsQuery.refetch(),
                    retrying: runsQuery.isFetching,
                }}
            />
        );
    }
    if (!runsQuery.data) return <DashboardBlueprintPendingSurface surface='runs' />;

    const plans = runsQuery.data.plans.map((plan) => ({
        ...plan,
        steps: inspection.stepPagesByPlanId[plan.id]?.steps ?? plan.steps,
        decisions: inspection.decisionPagesByPlanId[plan.id]?.decisions ?? plan.decisions,
        ...(plan.id === activePlan?.id && runProgress.run ? { run: runProgress.run } : {}),
    }));
    const refreshError = runsQuery.isError ? runsQuery.error : statusError;

    return (
        <DashboardBlueprintSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (runsQuery.isError) void runsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintRunsSurface
                workspace={{
                    busyAction,
                    deleteConfirmationByPlanId: runOperations.deleteConfirmationByPlanId,
                    runProgressIssue:
                        runProgress.issueCode && activePlan
                            ? { code: runProgress.issueCode, planId: activePlan.id }
                            : undefined,
                    runProgressRetrying: runProgress.retrying,
                    plans,
                    latestPlan: plans.at(0),
                    preflightByPlanId: runOperations.preflightByPlanId,
                    onApplyRun: (plan) => void runOperations.applyPlan(plan),
                    onApprovePlan: (plan) => void runOperations.reviewAndPreflight(plan),
                    onControlRun: (plan, request) => void runOperations.controlRun(plan, request),
                    onDeleteConfirmationChange: (planId, confirmation) =>
                        runOperations.setDeleteConfirmationByPlanId((current) => ({
                            ...current,
                            [planId]: confirmation,
                        })),
                    onLoadPlanSteps: (plan) => void inspection.loadPlanSteps(plan),
                    onLoadPlanDecisions: (plan) => void inspection.loadPlanDecisions(plan),
                    onPreflightRun: (plan) => void runOperations.preflightPlan(plan),
                    onRecoveryPlan: (plan) => {
                        void (async () => {
                            const recovery = await runOperations.createRecoveryPlan(plan);
                            if (recovery) setDeployFlow({ type: 'plan', plan: recovery });
                        })();
                    },
                    onRetryRunProgress: runProgress.retry,
                }}
            />
        </DashboardBlueprintSurfaceContent>
    );
}
