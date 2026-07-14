import { useQueryClient } from '@tanstack/react-query';
import { FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS } from '@neonflux/fluxer/guild-structure-snapshot';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import { useDashboardStructureDeployDraftState } from './dashboard-structure-deploy-draft-state.js';
import { DashboardStructureDeploySurface } from './dashboard-structure-deploy-surface.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-json.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatDate } from './dashboard-structure-panel-format.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { createDashboardStructureRestorePlan } from './dashboard-structure-restore-plan.js';
import { useDashboardStructureRunInspectionState } from './dashboard-structure-run-inspection-state.js';
import { useDashboardStructureRunOperations } from './dashboard-structure-run-operations.js';
import { useDashboardStructureRunsQuery } from './dashboard-structure-runs-query.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';
import {
    DashboardStructurePendingSurface,
    DashboardStructureSurfaceContent,
} from './dashboard-structure-surface-state.js';

export function DashboardStructureDeployRoute() {
    const runtime = useDashboardStructureRuntime();
    const {
        activeExecutionRun,
        deployFlow,
        executionProgress,
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
    const deployDraft = useDashboardStructureDeployDraftState({
        guildId,
        importJson,
        policy: structurePolicy,
        refreshAuditEvents,
        refreshRuns,
        seedRunActions: inspection.seedRunActions,
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

    async function importStructureFile(file: File | undefined): Promise<void> {
        if (!file) return;
        setStatus(undefined);
        if (file.size > FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes) {
            setStatus({ tone: 'error', message: 'Blueprint JSON must be 4 MiB or smaller.' });
            return;
        }
        try {
            setImportJson(await file.text());
            deployDraft.clearRoleMappings();
            setStatus({ tone: 'neutral', message: `Loaded ${file.name}. Create a deployment plan to review changes.` });
        } catch {
            setStatus({ tone: 'error', message: 'Server blueprint file could not be read.' });
        }
    }

    function inspectImportJson(): void {
        setStatus(undefined);
        const snapshot = parseDashboardStructureExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }
        setComparisonSource({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
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
        setStructurePolicy('synchronize');
        deployDraft.clearRoleMappings();
        setStatus(undefined);
    }

    if (!runsQuery.data && runsQuery.isError) {
        return (
            <DashboardStructurePendingSurface
                surface='deploy'
                error={{
                    diagnosticCode: readDashboardStructureDiagnosticCode(runsQuery.error),
                    retry: () => void runsQuery.refetch(),
                    retrying: runsQuery.isFetching,
                }}
            />
        );
    }
    if (!runsQuery.data) return <DashboardStructurePendingSurface surface='deploy' />;

    const importRuns = runsQuery.data.importRuns.map((run) => ({
        ...run,
        actions: inspection.actionPagesByRunId[run.id]?.actions ?? run.actions,
        decisions: inspection.decisionPagesByRunId[run.id]?.decisions ?? run.decisions,
        ...(run.id === activeExecutionRun?.id && executionProgress.execution
            ? { execution: executionProgress.execution }
            : {}),
    }));
    const latestRun = importRuns.at(0);
    const deployRun =
        deployFlow.type === 'latest'
            ? latestRun
            : deployFlow.type === 'run'
              ? (importRuns.find((run) => run.id === deployFlow.run.id) ?? deployFlow.run)
              : undefined;
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
            <DashboardStructureDeploySurface
                workspace={{
                    busyAction,
                    deleteConfirmationByRunId: runOperations.deleteConfirmationByRunId,
                    deployChoosingSource: deployFlow.type === 'choose',
                    deployRun,
                    executionProgressIssue:
                        executionProgress.issueCode && activeExecutionRun
                            ? { code: executionProgress.issueCode, runId: activeExecutionRun.id }
                            : undefined,
                    executionProgressRetrying: executionProgress.retrying,
                    importJson,
                    preflightByRunId: runOperations.preflightByRunId,
                    restoreShortcutBackupId: deployRun?.execution?.restorePointBackupId,
                    roleMappingConflicts: deployDraft.roleMappingConflicts,
                    roleMappings: deployDraft.roleMappings,
                    structurePolicy,
                    onApplyRun: (run) => void runOperations.applyImportRun(run),
                    onApprovePlan: (run) => void runOperations.reviewAndPreflight(run),
                    onControlExecution: (run, request) => void runOperations.controlExecution(run, request),
                    onCreatePlan: () => {
                        void (async () => {
                            const run = await deployDraft.createPlan();
                            if (run) setDeployFlow({ type: 'run', run });
                        })();
                    },
                    onCreateRestoreDryRun: (backupId) => {
                        void (async () => {
                            const run = await createRestorePlan({ backupId, intent: 'restore' });
                            if (run) setDeployFlow({ type: 'run', run });
                        })();
                    },
                    onDeleteConfirmationChange: (runId, confirmation) =>
                        runOperations.setDeleteConfirmationByRunId((current) => ({
                            ...current,
                            [runId]: confirmation,
                        })),
                    onImportJsonChange: (value) => {
                        setImportJson(value);
                        deployDraft.clearRoleMappings();
                    },
                    onImportStructureFile: importStructureFile,
                    onInspectImportJson: inspectImportJson,
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
        </DashboardStructureSurfaceContent>
    );
}
