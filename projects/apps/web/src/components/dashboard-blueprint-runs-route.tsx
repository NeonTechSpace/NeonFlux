import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import type { BlueprintBusyAction, PanelStatus } from './dashboard-blueprint-panel-types.js';
import {
    useDashboardBlueprintPreflightEvidenceQuery,
    useDashboardBlueprintVerificationEvidenceQuery,
} from './dashboard-blueprint-cold-detail-queries.js';
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
    const [visibleEvidencePlanId, setVisibleEvidencePlanId] = useState<string>();

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
    const visibleEvidencePlan = runsQuery.data?.plans.find((plan) => plan.id === visibleEvidencePlanId);
    const preflightEvidenceQuery = useDashboardBlueprintPreflightEvidenceQuery({
        checkedAt: visibleEvidencePlan?.preflight?.checkedAt,
        enabled: Boolean(visibleEvidencePlan),
        expiresAt: visibleEvidencePlan?.preflight?.expiresAt,
        guildId,
        preflightId: visibleEvidencePlan?.preflight?.id,
    });
    const verificationEvidenceQuery = useDashboardBlueprintVerificationEvidenceQuery({
        enabled: Boolean(visibleEvidencePlan?.run?.verificationEvidenceDigest),
        guildId,
        runId: visibleEvidencePlan?.run?.id,
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
        ...(plan.id === visibleEvidencePlanId && verificationEvidenceQuery.data
            ? { verification: verificationEvidenceQuery.data }
            : {}),
        steps: inspection.stepPagesByPlanId[plan.id]?.steps ?? plan.steps,
        decisions: inspection.decisionPagesByPlanId[plan.id]?.decisions ?? plan.decisions,
        ...(plan.id === activePlan?.id && runProgress.run ? { run: runProgress.run } : {}),
    }));
    const refreshError = runsQuery.isError
        ? runsQuery.error
        : preflightEvidenceQuery.isError
          ? preflightEvidenceQuery.error
          : verificationEvidenceQuery.isError
            ? verificationEvidenceQuery.error
            : statusError;

    return (
        <DashboardBlueprintSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (runsQuery.isError) void runsQuery.refetch();
                if (preflightEvidenceQuery.isError) void preflightEvidenceQuery.refetch();
                if (verificationEvidenceQuery.isError) void verificationEvidenceQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintRunsSurface
                workspace={{
                    busyAction,
                    runProgressIssue:
                        runProgress.issueCode && activePlan
                            ? { code: runProgress.issueCode, planId: activePlan.id }
                            : undefined,
                    runProgressRetrying: runProgress.retrying,
                    plans,
                    latestPlan: plans.at(0),
                    preflightByPlanId: Object.fromEntries(
                        plans.flatMap((plan) => {
                            const persisted =
                                plan.id === visibleEvidencePlanId ? preflightEvidenceQuery.data : undefined;
                            if (persisted) return [[plan.id, persisted]];
                            return Object.hasOwn(runOperations.preflightByPlanId, plan.id)
                                ? [[plan.id, runOperations.preflightByPlanId[plan.id]]]
                                : [];
                        })
                    ),
                    onControlRun: (plan, request) => void runOperations.controlRun(plan, request),
                    onLoadPlanSteps: (plan) => void inspection.loadPlanSteps(plan),
                    onLoadPlanDecisions: (plan) => void inspection.loadPlanDecisions(plan),
                    onPlanEvidenceVisibilityChange: (plan, visible) =>
                        setVisibleEvidencePlanId((current) =>
                            visible ? plan.id : current === plan.id ? undefined : current
                        ),
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
