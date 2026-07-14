import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS } from '@neonflux/fluxer/guild-structure-snapshot';
import { createContext, use, useState } from 'react';
import type { ReactNode } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardStructureBackupsQueryKey,
    getDashboardStructureQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import {
    downloadDashboardStructureExportRouteData,
    exportDashboardStructureRouteData,
    deleteDashboardStructureBackupRouteData,
    readDashboardStructureBackupPageRouteData,
    readDashboardStructureBackupJsonRouteData,
    renameDashboardStructureBackupRouteData,
    saveDashboardStructureBackupSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-diff.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardStructureErrorBoundary } from './dashboard-structure-error-boundary.js';
import type { DashboardStructureControllerState } from './dashboard-structure-controller-state.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { isBackupPageStateFresh } from './dashboard-structure-panel-backup-state.js';
import { downloadJsonFile } from './dashboard-structure-panel-download.js';
import { createDashboardStructureDriftActions } from './dashboard-structure-drift-actions.js';
import { useDashboardStructureExplorerState } from './dashboard-structure-panel-explorer-state.js';
import { formatBackupSource, formatCounts, formatDate } from './dashboard-structure-panel-format.js';
import { useDashboardStructureImportState } from './dashboard-structure-panel-import-state.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { BackupPageState, DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import { DashboardStructurePanelView, DashboardStructurePendingSurface } from './dashboard-structure-panel-view.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import type { DashboardStructurePanelViewProps, DashboardStructureSurface } from './dashboard-structure-panel-view.js';
import { useDashboardStructureWorkspaceQueries } from './dashboard-structure-workspace-queries.js';
import {
    DashboardStructureWorkspaceOutlet,
    DashboardStructureWorkspaceShell,
} from './dashboard-structure-workspace-shell.js';

const structureLiveArea = ['import_export', 'structure'] as const;
const DashboardStructureWorkspaceContext = createContext<DashboardStructurePanelViewProps | undefined>(undefined);
type DashboardStructureDeployFlow =
    | { type: 'latest' }
    | { type: 'choose' }
    | { type: 'run'; run: DashboardStructureImportRun };
const emptyBackupSettings: DashboardStructureBackupSettings = {
    enabled: false,
    cadenceWeeks: 1,
    retentionDays: 180,
};
const emptyObservedState = {
    changedSinceLastBackup: false,
    observedChangeCount: 0,
};

export function DashboardStructureWorkspace({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const surface = useRouterState({ select: (state) => readDashboardStructureSurface(state.location.pathname) });
    useDashboardLiveInvalidation({
        guildId,
        areas: structureLiveArea,
    });

    return (
        <DashboardStructureErrorBoundary
            onRetry={() => {
                void queryClient.invalidateQueries({ queryKey: getDashboardStructureQueryKey(guildId) });
            }}>
            <DashboardStructureController guildId={guildId} surface={surface}>
                {(state) => {
                    return (
                        <DashboardStructureWorkspaceShell
                            guildId={guildId}
                            activeRun={state.shell.activeRun}
                            executionProgressIssue={state.shell.executionProgressIssue}
                            executionTransport={state.shell.executionTransport}>
                            <DashboardStructureErrorBoundary
                                onRetry={() => {
                                    void queryClient.invalidateQueries({
                                        queryKey: getDashboardStructureQueryKey(guildId),
                                    });
                                }}>
                                {state.type === 'ready' ? (
                                    <DashboardStructureWorkspaceContext value={state.workspace}>
                                        <DashboardStructureWorkspaceOutlet />
                                    </DashboardStructureWorkspaceContext>
                                ) : (
                                    <DashboardStructurePendingSurface
                                        surface={surface}
                                        error={
                                            state.type === 'error'
                                                ? { diagnosticCode: state.diagnosticCode, retry: state.retry }
                                                : undefined
                                        }
                                    />
                                )}
                            </DashboardStructureErrorBoundary>
                        </DashboardStructureWorkspaceShell>
                    );
                }}
            </DashboardStructureController>
        </DashboardStructureErrorBoundary>
    );
}

export function DashboardStructureRouteSurface({ surface }: { surface: DashboardStructureSurface }) {
    const workspace = use(DashboardStructureWorkspaceContext);

    if (!workspace) throw new Error('Server Blueprint surface rendered outside its workspace.');

    return <DashboardStructurePanelView {...workspace} surface={surface} />;
}

function readDashboardStructureSurface(pathname: string): DashboardStructureSurface {
    if (pathname.endsWith('/backups')) return 'backups';
    if (pathname.endsWith('/compare')) return 'compare';
    if (pathname.endsWith('/deploy')) return 'deploy';
    if (pathname.endsWith('/runs')) return 'runs';
    return 'current';
}

function DashboardStructureController({
    guildId,
    surface,
    children,
}: {
    guildId: string;
    surface: DashboardStructureSurface;
    children: (state: DashboardStructureControllerState) => ReactNode;
}) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const backupsQueryKey = getDashboardStructureBackupsQueryKey(guildId);
    const runsQueryKey = getDashboardStructureRunsQueryKey(guildId);
    const statusQueryKey = getDashboardStructureStatusQueryKey(guildId);
    const [importJson, setImportJson] = useState('');
    const [structurePolicy, setStructurePolicy] = useState<DashboardStructurePolicy>('synchronize');
    const [deployFlow, setDeployFlow] = useState<DashboardStructureDeployFlow>({ type: 'latest' });
    const [backupJson, setBackupJson] = useState('');
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [backupEnabled, setBackupEnabled] = useState<boolean | undefined>();
    const [backupCadenceWeeks, setBackupCadenceWeeks] = useState<number | undefined>();
    const [backupRetentionDays, setBackupRetentionDays] = useState<number | undefined>();
    const [backupPageState, setBackupPageState] = useState<BackupPageState | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();
    const [editingBackupId, setEditingBackupId] = useState<string | undefined>();
    const [editingBackupName, setEditingBackupName] = useState('');
    const [deleteConfirmBackupId, setDeleteConfirmBackupId] = useState<string | undefined>();
    const {
        activeExecutionRun,
        backupsQuery,
        executionProgress,
        needsBackups,
        needsRuns,
        retryBackups,
        retryRuns,
        retryStatus,
        runsQuery,
        statusQuery,
    } = useDashboardStructureWorkspaceQueries(guildId, surface);
    const explorer = useDashboardStructureExplorerState({
        driftState,
        guildId,
        importJson,
        setBusyAction,
        setStatus,
    });
    const imports = useDashboardStructureImportState({
        guildId,
        policy: structurePolicy,
        importJson,
        refreshAuditEvents,
        refreshSettings: refreshRuns,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardStructureDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

    async function refreshBackups(options: { resetBackups?: boolean } = {}): Promise<void> {
        if (options.resetBackups) setBackupPageState(undefined);
        await queryClient.invalidateQueries({ queryKey: backupsQueryKey });
    }

    async function refreshRuns(): Promise<void> {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: runsQueryKey }),
            queryClient.invalidateQueries({ queryKey: statusQueryKey }),
        ]);
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    async function createBackup(): Promise<void> {
        setStatus(undefined);
        setBusyAction('backup');

        try {
            const result = await exportDashboardStructureRouteData({ data: { guildId } });

            if (result.type !== 'backup-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            setBackupJson(result.backupJson);
            setStatus({ tone: 'success', message: `Backup created for ${formatCounts(result.backup)}.` });
            await refreshBackups({ resetBackups: true });
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function downloadCurrentStructure(): Promise<void> {
        setStatus(undefined);
        setBusyAction('export');

        try {
            const result = await downloadDashboardStructureExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            downloadJsonFile(result.fileName, result.structureJson);
            setStatus({ tone: 'success', message: 'Current server blueprint downloaded. No backup was created.' });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function importStructureFile(file: File | undefined): Promise<void> {
        if (!file) return;

        setStatus(undefined);

        if (file.size > FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes) {
            setStatus({ tone: 'error', message: 'Blueprint JSON must be 4 MiB or smaller.' });
            return;
        }

        try {
            setImportJson(await file.text());
            imports.clearRoleMappings();
            setStatus({ tone: 'neutral', message: `Loaded ${file.name}. Create a deployment plan to review changes.` });
        } catch {
            setStatus({ tone: 'error', message: 'Server blueprint file could not be read.' });
        }
    }

    async function saveBackupSettings(draft?: DashboardStructureBackupSettingsValue): Promise<void> {
        const settings = backupsQuery.data?.backupSettings;
        const enabled = draft?.enabled ?? backupEnabled ?? settings?.enabled ?? false;
        const cadenceWeeks = draft?.cadenceWeeks ?? backupCadenceWeeks ?? settings?.cadenceWeeks ?? 1;
        const retentionDays = draft?.retentionDays ?? backupRetentionDays ?? settings?.retentionDays ?? 180;

        setStatus(undefined);
        setBusyAction('backup-settings');

        try {
            const result = await saveDashboardStructureBackupSettingsRouteData({
                data: { guildId, enabled, cadenceWeeks, retentionDays },
            });

            if (result.type !== 'backup-settings-saved') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setBackupEnabled(result.backupSettings.enabled);
            setBackupCadenceWeeks(result.backupSettings.cadenceWeeks);
            setBackupRetentionDays(result.backupSettings.retentionDays);
            setStatus({
                tone: 'success',
                message: result.backupSettings.enabled
                    ? `Automatic backups enabled every ${result.backupSettings.cadenceWeeks} week${
                          result.backupSettings.cadenceWeeks === 1 ? '' : 's'
                      }.`
                    : 'Automatic backups disabled. Manual backups are still available.',
            });
            await refreshBackups();
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadMoreBackups(): Promise<void> {
        const freshBackups = backupsQuery.data?.backups ?? [];
        const currentPage =
            (backupPageState && isBackupPageStateFresh(backupPageState, freshBackups) ? backupPageState : undefined) ??
            (backupsQuery.data
                ? {
                      backups: freshBackups,
                      ...(backupsQuery.data.backupNextCursor ? { nextCursor: backupsQuery.data.backupNextCursor } : {}),
                  }
                : undefined);
        if (!currentPage?.nextCursor) return;

        setStatus(undefined);
        setBusyAction('backup-page');

        try {
            const result = await readDashboardStructureBackupPageRouteData({
                data: { cursor: currentPage.nextCursor, guildId, limit: 50 },
            });

            if (result.type !== 'backup-page') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            setBackupPageState((current) => ({
                backups: [...(current?.backups ?? currentPage.backups), ...result.page.backups],
                ...(result.page.nextCursor ? { nextCursor: result.page.nextCursor } : {}),
            }));
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function renameBackup(backup: DashboardStructureBackupSummary): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-rename:${backup.id}`);

        try {
            const result = await renameDashboardStructureBackupRouteData({
                data: { backupId: backup.id, guildId, name: editingBackupName },
            });

            if (result.type !== 'backup-renamed') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setBackupPageState((current) => ({
                ...(current ?? { backups: [] }),
                backups: (current?.backups ?? []).map((candidate) =>
                    candidate.id === result.backup.id ? result.backup : candidate
                ),
            }));
            setEditingBackupId(undefined);
            setEditingBackupName('');
            setStatus({ tone: 'success', message: 'Backup renamed.' });
            await refreshBackups({ resetBackups: true });
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function deleteBackup(backup: DashboardStructureBackupSummary): Promise<void> {
        if (deleteConfirmBackupId !== backup.id) {
            setDeleteConfirmBackupId(backup.id);
            return;
        }

        setStatus(undefined);
        setBusyAction(`backup-delete:${backup.id}`);

        try {
            const result = await deleteDashboardStructureBackupRouteData({
                data: { backupId: backup.id, guildId },
            });

            if (result.type !== 'backup-deleted') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'restore-point-protected'
                          ? {
                                tone: 'error',
                                message:
                                    'Restore-point backups are retained for deployment recovery and cannot be deleted manually.',
                            }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setBackupPageState((current) => ({
                ...(current ?? { backups: [] }),
                backups: (current?.backups ?? []).filter((candidate) => candidate.id !== result.backupId),
            }));
            setDeleteConfirmBackupId(undefined);
            setStatus({ tone: 'success', message: 'Backup deleted.' });
            await refreshBackups({ resetBackups: true });
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function importBackup(backup: DashboardStructureBackupSummary): Promise<void> {
        if (backup.source !== 'restore_point') {
            await loadBackupJson(backup, 'use');
            return;
        }

        const createdRun = await imports.createDryRunFromBackupId({ backupId: backup.id, intent: 'restore' });
        if (!createdRun) return;
        setDeployFlow({ type: 'run', run: createdRun });
        await navigate({ to: '/dashboard/$guildId/structure/deploy', params: { guildId } });
    }

    async function loadBackupJson(
        backup: DashboardStructureBackupSummary,
        mode: 'download' | 'inspect' | 'use'
    ): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-json:${backup.id}`);

        try {
            const result = await readDashboardStructureBackupJsonRouteData({
                data: { backupId: backup.id, guildId },
            });

            if (result.type !== 'backup-json') {
                setStatus(
                    result.type === 'backup-json-unavailable'
                        ? { tone: 'error', message: 'This backup does not have server blueprint JSON.' }
                        : toErrorStatus(result.type)
                );
                return;
            }

            if (mode === 'download') {
                downloadJsonFile(result.fileName, result.backupJson);
                setStatus({ tone: 'success', message: 'Backup JSON downloaded.' });
                return;
            }

            if (mode === 'inspect') {
                const snapshot = parseDashboardStructureExplorerSnapshot(result.backupJson);
                if (!snapshot) {
                    setStatus({ tone: 'error', message: 'Backup JSON could not be parsed for the explorer.' });
                    return;
                }

                explorer.setExplorerSourceAndResetComparison({
                    canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                    detail: `${formatBackupSource(backup.source)} · ${formatDate(backup.completedAt)}`,
                    label: backup.name,
                    snapshot,
                    type: 'backup',
                });
                explorer.setSelectedExplorerEntityKey(undefined);
                setStatus({ tone: 'neutral', message: 'Backup loaded in explorer.' });
                await navigate({ to: '/dashboard/$guildId/structure/compare', params: { guildId } });
                return;
            }

            beginDeploySource(result.backupJson);
            await navigate({ to: '/dashboard/$guildId/structure/deploy', params: { guildId } });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    function beginDeploySource(sourceJson = ''): void {
        setDeployFlow({ type: 'choose' });
        setImportJson(sourceJson);
        setStructurePolicy('synchronize');
        imports.clearRoleMappings();
        setStatus(
            sourceJson
                ? {
                      tone: 'neutral',
                      message: 'Backup loaded as the deployment source. Choose how it should apply.',
                  }
                : undefined
        );
    }

    const shellActiveRun = activeExecutionRun
        ? {
              ...activeExecutionRun,
              ...(executionProgress.execution ? { execution: executionProgress.execution } : {}),
          }
        : undefined;
    const shell = {
        ...(shellActiveRun ? { activeRun: shellActiveRun } : {}),
        ...(executionProgress.issueCode && activeExecutionRun
            ? { executionProgressIssue: { code: executionProgress.issueCode, runId: activeExecutionRun.id } }
            : {}),
        executionTransport: executionProgress.transport,
    };
    const requiredQueries = [needsBackups ? backupsQuery : undefined, needsRuns ? runsQuery : undefined].filter(
        (query): query is typeof backupsQuery | typeof runsQuery => query !== undefined
    );
    const coldErrorQuery = requiredQueries.find((query) => !query.data && query.isError);
    if (coldErrorQuery) {
        return children({
            type: 'error',
            diagnosticCode: readDashboardStructureDiagnosticCode(coldErrorQuery.error),
            retry: () => {
                if (needsBackups && !backupsQuery.data) retryBackups();
                if (needsRuns && !runsQuery.data) retryRuns();
            },
            shell,
        });
    }
    if (requiredQueries.some((query) => !query.data)) return children({ type: 'loading', shell });

    const importRuns = (runsQuery.data?.importRuns ?? []).map((run) => ({
        ...run,
        actions: imports.actionPagesByRunId[run.id]?.actions ?? run.actions,
        decisions: imports.decisionPagesByRunId[run.id]?.decisions ?? run.decisions,
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
    const backupSettings = backupsQuery.data?.backupSettings ?? emptyBackupSettings;
    const enabledDraft = backupEnabled ?? backupSettings.enabled;
    const cadenceDraft = backupCadenceWeeks ?? backupSettings.cadenceWeeks;
    const retentionDraft = backupRetentionDays ?? backupSettings.retentionDays;
    const backupPage =
        backupPageState && isBackupPageStateFresh(backupPageState, backupsQuery.data?.backups ?? [])
            ? backupPageState
            : {
                  backups: backupsQuery.data?.backups ?? [],
                  ...(backupsQuery.data?.backupNextCursor ? { nextCursor: backupsQuery.data.backupNextCursor } : {}),
              };
    const refreshError = requiredQueries.find((query) => query.isError)?.error ?? statusQuery.error;

    return children({
        type: 'ready',
        shell,
        workspace: {
            backupJson,
            backupPage,
            backupSettings,
            busyAction,
            cadenceDraft,
            deleteConfirmBackupId,
            deleteConfirmationByRunId: imports.deleteConfirmationByRunId,
            driftState,
            editingBackupId,
            editingBackupName,
            enabledDraft,
            executionProgressIssue:
                executionProgress.issueCode && activeExecutionRun
                    ? {
                          code: executionProgress.issueCode,
                          runId: activeExecutionRun.id,
                      }
                    : undefined,
            executionProgressRetrying: executionProgress.retrying,
            executionTransport: executionProgress.transport,
            explorer,
            deployChoosingSource: deployFlow.type === 'choose',
            deployRun,
            structurePolicy,
            importJson,
            importRuns,
            latestRun,
            observedState: backupsQuery.data?.observedState ?? emptyObservedState,
            preflightByRunId: imports.preflightByRunId,
            restoreShortcutBackupId: deployRun?.execution?.restorePointBackupId,
            roleMappingConflicts: imports.roleMappingConflicts,
            roleMappings: imports.roleMappings,
            retentionDraft,
            settingsRefreshIssue: refreshError
                ? { code: readDashboardStructureDiagnosticCode(refreshError) }
                : undefined,
            status,
            onApplyRun: (run) => void imports.applyImportRun(run),
            onControlExecution: (run, request) => void imports.controlExecution(run, request),
            onBackupCadenceWeeksChange: setBackupCadenceWeeks,
            onBackupDelete: (backup) => void deleteBackup(backup),
            onBackupDownload: (backup) => void loadBackupJson(backup, 'download'),
            onBackupEnabledChange: setBackupEnabled,
            onBackupImport: (backup) => void importBackup(backup),
            onBackupInspect: (backup) => void loadBackupJson(backup, 'inspect'),
            onBackupRename: (backup) => void renameBackup(backup),
            onBackupRenameNameChange: setEditingBackupName,
            onBackupRetentionDaysChange: setBackupRetentionDays,
            onBeginBackupRename: (backup) => {
                setEditingBackupId(backup.id);
                setEditingBackupName(backup.name);
                setDeleteConfirmBackupId(undefined);
            },
            onCancelBackupDelete: () => setDeleteConfirmBackupId(undefined),
            onCancelBackupRename: () => {
                setEditingBackupId(undefined);
                setEditingBackupName('');
            },
            onCheckBackupDrift: (backup) => void driftActions.check(backup),
            onCheckLatestDrift: () => void driftActions.check(),
            onApprovePlan: (run) => void imports.reviewAndPreflight(run),
            onCreateBackup: () => void createBackup(),
            onCreatePlan: () => {
                void (async () => {
                    const createdRun = await imports.createPlan();
                    if (createdRun) setDeployFlow({ type: 'run', run: createdRun });
                })();
            },
            onCreateRestoreDryRun: (backupId) => {
                void (async () => {
                    const createdRun = await imports.createDryRunFromBackupId({ backupId, intent: 'restore' });
                    if (!createdRun) return;
                    setDeployFlow({ type: 'run', run: createdRun });
                    await navigate({ to: '/dashboard/$guildId/structure/deploy', params: { guildId } });
                })();
            },
            onDeleteConfirmationChange: (runId, confirmation) =>
                imports.setDeleteConfirmationByRunId((current) => ({ ...current, [runId]: confirmation })),
            onDownloadCurrentStructure: () => void downloadCurrentStructure(),
            onImportJsonChange: (value) => {
                setImportJson(value);
                imports.clearRoleMappings();
            },
            onStructurePolicyChange: (value) => {
                setStructurePolicy(value);
                imports.clearRoleMappings();
            },
            onRoleMappingChange: (sourceId, targetId) =>
                imports.setRoleMappings((current) => {
                    if (!targetId) {
                        const next = { ...current };
                        delete next[sourceId];
                        return next;
                    }

                    return { ...current, [sourceId]: targetId };
                }),
            onImportStructureFile: importStructureFile,
            onInspectCurrentLayout: () => {
                void (async () => {
                    await explorer.loadLiveExplorerSnapshot();
                    await navigate({ to: '/dashboard/$guildId/structure/compare', params: { guildId } });
                })();
            },
            onInspectImportJson: () => {
                if (!explorer.inspectImportJson()) return;
                void navigate({ to: '/dashboard/$guildId/structure/compare', params: { guildId } });
            },
            onLoadMoreBackups: () => void loadMoreBackups(),
            onLoadRunActions: (run) => void imports.loadRunActions(run),
            onLoadRunDecisions: (run) => void imports.loadRunDecisions(run),
            onPreflightRun: (run) => void imports.preflightImportRun(run),
            onRetryExecutionProgress: () => {
                executionProgress.retry();
            },
            onRetrySettingsRefresh: () => {
                if (backupsQuery.isError) retryBackups();
                if (runsQuery.isError) retryRuns();
                if (statusQuery.isError) retryStatus();
            },
            onStartNewBlueprintDeployment: () => beginDeploySource(),
            onRecoveryPlan: (run) => {
                void (async () => {
                    const createdRun = await imports.createRecoveryPlan(run);
                    if (createdRun) setDeployFlow({ type: 'run', run: createdRun });
                })();
            },
            onReviewScheduledDrift: (baselineBackupId) => void driftActions.reviewScheduled(baselineBackupId),
            onSaveBackupSettings: (value) => void saveBackupSettings(value),
            onSetBackupJsonAsImportJson: () => {
                beginDeploySource(backupJson);
                void navigate({ to: '/dashboard/$guildId/structure/deploy', params: { guildId } });
            },
        },
    });
}
