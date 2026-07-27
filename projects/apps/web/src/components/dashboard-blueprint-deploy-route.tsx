import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BLUEPRINT_SNAPSHOT_LIMITS, isBlueprintSnapshotJsonWithinByteLimit } from '@neonflux/blueprint/snapshot';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import { useDashboardBlueprintDeployDraftState } from './dashboard-blueprint-deploy-draft-state.js';
import {
    mergeDashboardBlueprintPlanColdDetail,
    useDashboardBlueprintPlanAuthorityQuery,
    useDashboardBlueprintPreflightEvidenceQuery,
    useDashboardBlueprintVerificationEvidenceQuery,
} from './dashboard-blueprint-cold-detail-queries.js';
import { useDashboardBlueprintDeployRouteSync } from './dashboard-blueprint-deploy-route-sync.js';
import { DashboardBlueprintDeploySurface } from './dashboard-blueprint-deploy-surface.js';
import { readDashboardBlueprintSourceFiles } from './dashboard-blueprint-deploy-source-state.js';
import type { DashboardBlueprintSourceState } from './dashboard-blueprint-deploy-source-state.js';
import {
    deriveDashboardBlueprintDeployJourney,
    isDashboardBlueprintSourceReady,
} from './dashboard-blueprint-deploy-stage.js';
import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';
import { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';
import { parseDashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-snapshot.js';
import type { BlueprintBusyAction, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';
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
    const [pasteJson, setPasteJson] = useState(importJson);
    const [sourceState, setSourceState] = useState<DashboardBlueprintSourceState>(() =>
        isDashboardBlueprintSourceReady(importJson)
            ? { status: 'ready', mode: 'paste', json: importJson }
            : { status: 'empty', mode: 'file' }
    );
    const sourceReadIdRef = useRef(0);

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

    function resetSource(mode: 'file' | 'paste' = 'file'): void {
        sourceReadIdRef.current += 1;
        setSourceState({ status: 'empty', mode });
        setPasteJson('');
        setImportJson('');
        deployDraft.clearRoleMappings();
        setStatus(undefined);
    }

    function changeSourceMode(mode: 'file' | 'paste'): void {
        if (sourceState.mode === mode) return;
        resetSource(mode);
    }

    function changePasteJson(value: string): void {
        sourceReadIdRef.current += 1;
        setPasteJson(value);
        setStatus(undefined);
        setImportJson('');
        deployDraft.clearRoleMappings();
        if (!value.trim()) {
            setSourceState({ status: 'empty', mode: 'paste' });
            return;
        }
        if (!isBlueprintSnapshotJsonWithinByteLimit(value)) {
            setSourceState({ status: 'invalid', mode: 'paste', message: 'Paste Blueprint JSON up to 4 MiB.' });
            return;
        }
        if (!isDashboardBlueprintSourceReady(value)) {
            setSourceState({ status: 'invalid', mode: 'paste', message: 'This is not valid Blueprint JSON.' });
            return;
        }
        setImportJson(value);
        setSourceState({ status: 'ready', mode: 'paste', json: value });
    }

    async function importStructureFiles(files: readonly File[]): Promise<void> {
        const readId = ++sourceReadIdRef.current;
        setStatus(undefined);
        setImportJson('');
        setPasteJson('');
        deployDraft.clearRoleMappings();
        if (files.length === 1 && files[0].size <= BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes) {
            setSourceState({ status: 'reading', mode: 'file', fileName: files[0].name });
        }
        const nextState = await readDashboardBlueprintSourceFiles(files);
        if (sourceReadIdRef.current !== readId) return;
        setSourceState(nextState);
        if (nextState.status === 'ready') setImportJson(nextState.json);
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
        setDeployFlow({ type: 'draft', step: 'source' });
        resetSource();
        setStructurePolicy('synchronize');
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
    const selectedDeployPlan =
        deployFlow.type === 'latest'
            ? latestPlan
            : deployFlow.type === 'plan'
              ? (plans.find((plan) => plan.id === deployFlow.plan.id) ?? deployFlow.plan)
              : undefined;
    const journey = deriveDashboardBlueprintDeployJourney({
        draftStep: deployFlow.type === 'draft' ? deployFlow.step : undefined,
        hasParsedSource: isDashboardBlueprintSourceReady(importJson),
        plan: selectedDeployPlan,
        preflight: selectedDeployPlan?.preflight,
    });
    const authorityQuery = useDashboardBlueprintPlanAuthorityQuery({
        enabled: journey.step === 'review',
        guildId,
        planId: selectedDeployPlan?.id,
    });
    const preflightEvidenceQuery = useDashboardBlueprintPreflightEvidenceQuery({
        checkedAt: selectedDeployPlan?.preflight?.checkedAt,
        enabled: journey.step === 'safety' || journey.step === 'confirm',
        expiresAt: selectedDeployPlan?.preflight?.expiresAt,
        guildId,
        preflightId: selectedDeployPlan?.preflight?.id,
    });
    const verificationEvidenceQuery = useDashboardBlueprintVerificationEvidenceQuery({
        enabled: journey.step === 'deploy' && Boolean(selectedDeployPlan?.run?.verificationEvidenceDigest),
        guildId,
        runId: selectedDeployPlan?.run?.id,
    });
    const selectedAuthority =
        selectedDeployPlan && authorityQuery.data?.id === selectedDeployPlan.id ? authorityQuery.data : undefined;
    const reviewAuthority =
        journey.step === 'review' && selectedDeployPlan
            ? {
                  planId: selectedDeployPlan.id,
                  status: selectedAuthority
                      ? ('ready' as const)
                      : authorityQuery.isError
                        ? ('error' as const)
                        : ('loading' as const),
                  retrying: authorityQuery.isFetching,
              }
            : { status: 'idle' as const, retrying: false };
    const deployPlan = selectedDeployPlan
        ? {
              ...mergeDashboardBlueprintPlanColdDetail(selectedDeployPlan, selectedAuthority),
              ...(verificationEvidenceQuery.data ? { verification: verificationEvidenceQuery.data } : {}),
              steps: inspection.stepPagesByPlanId[selectedDeployPlan.id]?.steps ?? selectedDeployPlan.steps,
              decisions:
                  inspection.decisionPagesByPlanId[selectedDeployPlan.id]?.decisions ?? selectedDeployPlan.decisions,
          }
        : undefined;

    const selectRequestedPlan = useCallback(
        (plan: (typeof plans)[number]) => setDeployFlow({ type: 'plan', plan }),
        [setDeployFlow]
    );
    const replaceDeployRoute = useCallback(
        (planId: string | undefined, step: DashboardBlueprintDeployJourneyStep) => {
            void navigate({
                to: '/dashboard/$guildId/blueprint/deploy',
                params: { guildId },
                search: { ...(planId ? { plan: planId } : {}), step },
                replace: true,
            });
        },
        [guildId, navigate]
    );
    useDashboardBlueprintDeployRouteSync({
        guildId,
        ready: Boolean(runsQuery.data),
        requestedPlanId,
        requestedStep,
        requestedPlan,
        requestedPlanMissing,
        selectedPlanId: deployPlan?.id,
        selectedStep: journey.step,
        onSelectRequestedPlan: selectRequestedPlan,
        onReplaceRoute: replaceDeployRoute,
    });

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

    const coldDetailError = [authorityQuery, preflightEvidenceQuery, verificationEvidenceQuery].find(
        (query) => query.isError
    )?.error;
    const refreshError = runsQuery.isError ? runsQuery.error : (coldDetailError ?? statusError);
    const persistedPreflight = preflightEvidenceQuery.data;
    const preflightByPlanId =
        deployPlan && persistedPreflight
            ? { ...runOperations.preflightByPlanId, [deployPlan.id]: persistedPreflight }
            : runOperations.preflightByPlanId;

    return (
        <DashboardBlueprintSurfaceContent onRetryRefresh={() => undefined}>
            <DashboardBlueprintDeploySurface
                workspace={{
                    busyAction,
                    confirmationByPlanId: runOperations.confirmationByPlanId,
                    deployDraftStep: requestedPlanMissing
                        ? 'source'
                        : deployFlow.type === 'draft'
                          ? deployFlow.step
                          : undefined,
                    deployPlan: requestedPlanMissing ? undefined : deployPlan,
                    operationStatus: requestedPlanMissing
                        ? { tone: 'error', message: 'This Blueprint plan is not available for the selected server.' }
                        : status,
                    pasteJson,
                    runProgressIssue:
                        runProgress.issueCode && activePlan
                            ? { code: runProgress.issueCode, planId: activePlan.id }
                            : undefined,
                    runProgressRetrying: runProgress.retrying,
                    preflightByPlanId,
                    reviewAuthority,
                    refreshIssue: refreshError
                        ? { code: readDashboardBlueprintDiagnosticCode(refreshError) }
                        : undefined,
                    refreshRetrying: runsQuery.isFetching || runtime.statusRefreshing,
                    roleMappingConflicts: deployDraft.roleMappingConflicts,
                    roleMappings: deployDraft.roleMappings,
                    sourceState,
                    structurePolicy,
                    targetGuildId: guildId,
                    targetGuildName: runsQuery.data.targetGuildName,
                    onApplyRun: (plan) => void runOperations.applyPlan(plan),
                    onApprovePlan: (plan) => {
                        if (reviewAuthority.status !== 'ready' || reviewAuthority.planId !== plan.id) return;
                        void runOperations.reviewAndPreflight(plan);
                    },
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
                    onChangeSource: () => setDeployFlow({ type: 'draft', step: 'source' }),
                    onContinueSource: () => {
                        if (sourceState.status === 'ready') setDeployFlow({ type: 'draft', step: 'configure' });
                    },
                    onFilesSelected: (files) => void importStructureFiles(files),
                    onInspectImportJson: inspectImportJson,
                    onLoadPlanSteps: (plan) => void inspection.loadPlanSteps(plan),
                    onLoadPlanDecisions: (plan) => void inspection.loadPlanDecisions(plan),
                    onModeChange: changeSourceMode,
                    onPasteJsonChange: changePasteJson,
                    onPreflightRun: (plan) => void runOperations.preflightPlan(plan),
                    onRecoveryPlan: (plan) => {
                        void (async () => {
                            const recovery = await runOperations.createRecoveryPlan(plan);
                            if (recovery) setDeployFlow({ type: 'plan', plan: recovery });
                        })();
                    },
                    onRetryRunProgress: runProgress.retry,
                    onRetryRefresh: () => {
                        if (runsQuery.isError) void runsQuery.refetch();
                        if (authorityQuery.isError) void authorityQuery.refetch();
                        if (preflightEvidenceQuery.isError) void preflightEvidenceQuery.refetch();
                        if (verificationEvidenceQuery.isError) void verificationEvidenceQuery.refetch();
                        if (statusError) retryStatus();
                    },
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
