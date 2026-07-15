import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BLUEPRINT_SNAPSHOT_LIMITS } from '@neonflux/blueprint/snapshot';
import { useEffect, useMemo, useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import { useDashboardBlueprintDeployDraftState } from './dashboard-blueprint-deploy-draft-state.js';
import { DashboardBlueprintDeploySurface } from './dashboard-blueprint-deploy-surface.js';
import {
    deriveDashboardBlueprintDeployJourney,
    isDashboardBlueprintSourceReady,
} from './dashboard-blueprint-deploy-stage.js';
import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';
import { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';
import { parseDashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-snapshot.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';
import { readDashboardBlueprintDiagnosticCode } from './dashboard-blueprint-progress.js';
import { createDashboardBlueprintRestorePlan } from './dashboard-blueprint-restore-plan.js';
import { useDashboardBlueprintPlanInspectionState } from './dashboard-blueprint-plan-inspection-state.js';
import { useDashboardBlueprintRunOperations } from './dashboard-blueprint-run-operations.js';
import { useDashboardBlueprintRunsQuery } from './dashboard-blueprint-runs-query.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';
import {
    DashboardBlueprintPendingSurface,
    DashboardBlueprintSurfaceContent,
} from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintDeployRoute({
    requestedPlanId,
    requestedStep,
}: {
    requestedPlanId?: string;
    requestedStep?: DashboardBlueprintDeployJourneyStep;
}) {
    const runtime = useDashboardBlueprintRuntime();
    const {
        activePlan,
        deployFlow,
        runProgress,
        guildId,
        importJson,
        navigateToSurface,
        retryStatus,
        setComparisonSource,
        setDeployFlow,
        setImportJson,
        setStructurePolicy,
        statusError,
        structurePolicy,
    } = runtime;
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const runsQuery = useDashboardBlueprintRunsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<BlueprintBusyAction | undefined>();
    const [sourceFile, setSourceFile] = useState<{ name: string; size: number }>();

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
    const deployDraft = useDashboardBlueprintDeployDraftState({
        guildId,
        importJson,
        policy: structurePolicy,
        refreshAuditEvents,
        refreshRuns,
        seedPlanSteps: inspection.seedPlanSteps,
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

    async function importStructureFile(file: File | undefined): Promise<void> {
        if (!file) return;
        setStatus(undefined);
        if (file.size > BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes) {
            setSourceFile(undefined);
            setStatus({ tone: 'error', message: 'Blueprint JSON must be 4 MiB or smaller.' });
            return;
        }
        try {
            setImportJson(await file.text());
            setSourceFile({ name: file.name, size: file.size });
            deployDraft.clearRoleMappings();
            setStatus({ tone: 'neutral', message: `Loaded ${file.name}. Create a deployment plan to review changes.` });
        } catch {
            setStatus({ tone: 'error', message: 'Server blueprint file could not be read.' });
        }
    }

    function inspectImportJson(): void {
        setStatus(undefined);
        const snapshot = parseDashboardBlueprintExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }
        setComparisonSource({
            canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
            label: 'Import JSON',
            snapshot,
            type: 'import-json',
            ...(snapshot.exportedAt ? { detail: `Exported ${formatDate(snapshot.exportedAt)}` } : {}),
        });
        void navigateToSurface('compare');
    }

    function startNewDeployment(): void {
        setDeployFlow({ type: 'choose' });
        setImportJson('');
        setSourceFile(undefined);
        setStructurePolicy('synchronize');
        deployDraft.clearRoleMappings();
        setStatus(undefined);
    }

    const plans = useMemo(
        () =>
            (runsQuery.data?.plans ?? []).map((plan) => ({
                ...plan,
                steps: inspection.stepPagesByPlanId[plan.id]?.steps ?? plan.steps,
                decisions: inspection.decisionPagesByPlanId[plan.id]?.decisions ?? plan.decisions,
                ...(plan.id === activePlan?.id && runProgress.run ? { run: runProgress.run } : {}),
            })),
        [
            activePlan?.id,
            inspection.decisionPagesByPlanId,
            inspection.stepPagesByPlanId,
            runProgress.run,
            runsQuery.data?.plans,
        ]
    );
    const latestPlan = plans.at(0);
    const requestedPlan = requestedPlanId ? plans.find((plan) => plan.id === requestedPlanId) : undefined;
    const requestedPlanMissing = Boolean(requestedPlanId && !requestedPlan);
    const deployPlan =
        deployFlow.type === 'latest'
            ? latestPlan
            : deployFlow.type === 'plan'
              ? (plans.find((plan) => plan.id === deployFlow.plan.id) ?? deployFlow.plan)
              : undefined;
    const journey = deriveDashboardBlueprintDeployJourney({
        choosingSource: deployFlow.type === 'choose',
        hasParsedSource: isDashboardBlueprintSourceReady(importJson),
        plan: deployPlan,
        preflight: deployPlan?.preflight,
    });

    useEffect(() => {
        if (!runsQuery.data || !requestedPlanId) return;
        if (!requestedPlan) return;
        if (deployFlow.type !== 'plan' || deployFlow.plan.id !== requestedPlan.id) {
            setDeployFlow({ type: 'plan', plan: requestedPlan });
        }
    }, [deployFlow, requestedPlan, requestedPlanId, runsQuery.data, setDeployFlow]);

    useEffect(() => {
        if (!runsQuery.data) return;
        if (requestedPlanMissing) return;
        const canonicalPlanId = deployPlan?.id;
        if (requestedPlanId === canonicalPlanId && requestedStep === journey.step) return;
        void navigate({
            to: '/dashboard/$guildId/blueprint/deploy',
            params: { guildId },
            search: { ...(canonicalPlanId ? { plan: canonicalPlanId } : {}), step: journey.step },
            replace: true,
        });
    }, [
        deployPlan?.id,
        guildId,
        journey.step,
        navigate,
        requestedPlanId,
        requestedPlanMissing,
        requestedStep,
        runsQuery.data,
    ]);

    if (!runsQuery.data && runsQuery.isError) {
        return (
            <DashboardBlueprintPendingSurface
                surface='deploy'
                error={{
                    diagnosticCode: readDashboardBlueprintDiagnosticCode(runsQuery.error),
                    retry: () => void runsQuery.refetch(),
                    retrying: runsQuery.isFetching,
                }}
            />
        );
    }
    if (!runsQuery.data) return <DashboardBlueprintPendingSurface surface='deploy' />;

    const refreshError = runsQuery.isError ? runsQuery.error : statusError;

    return (
        <DashboardBlueprintSurfaceContent
            status={
                requestedPlanMissing
                    ? { tone: 'error', message: 'This Blueprint plan is not available for the selected server.' }
                    : status
            }
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={runsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (runsQuery.isError) void runsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintDeploySurface
                workspace={{
                    busyAction,
                    confirmationByPlanId: runOperations.confirmationByPlanId,
                    deployChoosingSource: requestedPlanMissing || deployFlow.type === 'choose',
                    deployPlan: requestedPlanMissing ? undefined : deployPlan,
                    runProgressIssue:
                        runProgress.issueCode && activePlan
                            ? { code: runProgress.issueCode, planId: activePlan.id }
                            : undefined,
                    runProgressRetrying: runProgress.retrying,
                    importJson,
                    preflightByPlanId: runOperations.preflightByPlanId,
                    restoreShortcutBackupId: deployPlan?.run?.restorePointBackupId,
                    roleMappingConflicts: deployDraft.roleMappingConflicts,
                    roleMappings: deployDraft.roleMappings,
                    sourceFile,
                    structurePolicy,
                    targetGuildId: guildId,
                    targetGuildName: runsQuery.data.targetGuildName,
                    onApplyRun: (plan) => void runOperations.applyPlan(plan),
                    onApprovePlan: (plan) => void runOperations.reviewAndPreflight(plan),
                    onControlRun: (plan, request) => void runOperations.controlRun(plan, request),
                    onCreatePlan: () => {
                        void (async () => {
                            const plan = await deployDraft.createPlan();
                            if (plan) setDeployFlow({ type: 'plan', plan });
                        })();
                    },
                    onCreateRestorePlan: (backupId) => {
                        void (async () => {
                            const plan = await createRestorePlan({ backupId, intent: 'restore' });
                            if (plan) setDeployFlow({ type: 'plan', plan });
                        })();
                    },
                    onConfirmationChange: (planId, confirmation) =>
                        runOperations.setConfirmationByPlanId((current) => ({
                            ...current,
                            [planId]: confirmation,
                        })),
                    onImportJsonChange: (value) => {
                        setImportJson(value);
                        setSourceFile(undefined);
                        deployDraft.clearRoleMappings();
                    },
                    onImportStructureFile: importStructureFile,
                    onInspectImportJson: inspectImportJson,
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
                    onRoleMappingChange: (sourceId, targetId) =>
                        deployDraft.setRoleMappings((current) => {
                            if (!targetId) {
                                const next = { ...current };
                                delete next[sourceId];
                                return next;
                            }
                            return { ...current, [sourceId]: targetId };
                        }),
                    onStartNewBlueprintDeployment: startNewDeployment,
                    onStructurePolicyChange: (value) => {
                        setStructurePolicy(value);
                        deployDraft.clearRoleMappings();
                    },
                }}
            />
        </DashboardBlueprintSurfaceContent>
    );
}
