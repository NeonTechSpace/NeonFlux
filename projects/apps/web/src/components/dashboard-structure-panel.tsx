import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useState } from 'react';
import type { ReactNode } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardStructureSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    downloadDashboardStructureExportRouteData,
    exportDashboardStructureRouteData,
    deleteDashboardStructureBackupRouteData,
    readDashboardStructureBackupPageRouteData,
    readDashboardStructureBackupJsonRouteData,
    renameDashboardStructureBackupRouteData,
    saveDashboardStructureBackupSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureBackupSummary } from '../server/dashboard-structure.server.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-diff.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardStructureErrorBoundary, DashboardStructureErrorState } from './dashboard-structure-error-boundary.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { isBackupPageStateFresh } from './dashboard-structure-panel-backup-state.js';
import { downloadJsonFile } from './dashboard-structure-panel-download.js';
import { createDashboardStructureDriftActions } from './dashboard-structure-drift-actions.js';
import { useDashboardStructureExplorerState } from './dashboard-structure-panel-explorer-state.js';
import { formatBackupSource, formatCounts, formatDate } from './dashboard-structure-panel-format.js';
import { useDashboardStructureImportState } from './dashboard-structure-panel-import-state.js';
import { DashboardStructureLoading } from './dashboard-structure-panel-shared.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { toErrorStatus } from './dashboard-structure-panel-status.js';
import type { BackupPageState, DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import { DashboardStructurePanelView } from './dashboard-structure-panel-view.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import type { DashboardStructurePanelViewProps, DashboardStructureSurface } from './dashboard-structure-panel-view.js';
import { useDashboardStructureWorkspaceQueries } from './dashboard-structure-workspace-queries.js';
import {
    DashboardStructureWorkspaceOutlet,
    DashboardStructureWorkspaceShell,
} from './dashboard-structure-workspace-shell.js';

const structureLiveArea = ['import_export', 'structure'] as const;
const DashboardStructureWorkspaceContext = createContext<DashboardStructurePanelViewProps | undefined>(undefined);

export function DashboardStructureWorkspace({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    useDashboardLiveInvalidation({
        guildId,
        areas: structureLiveArea,
    });

    return (
        <DashboardStructureErrorBoundary
            onRetry={() => {
                void queryClient.invalidateQueries({ queryKey: getDashboardStructureSettingsQueryKey(guildId) });
            }}>
            <DashboardStructureController guildId={guildId}>
                {(workspace) => (
                    <DashboardStructureWorkspaceContext value={workspace}>
                        <DashboardStructureWorkspaceShell guildId={guildId}>
                            <DashboardStructureWorkspaceOutlet />
                        </DashboardStructureWorkspaceShell>
                    </DashboardStructureWorkspaceContext>
                )}
            </DashboardStructureController>
        </DashboardStructureErrorBoundary>
    );
}

export function DashboardStructureRouteSurface({ surface }: { surface: DashboardStructureSurface }) {
    const workspace = use(DashboardStructureWorkspaceContext);

    if (!workspace) throw new Error('Server Blueprint surface rendered outside its workspace.');

    return <DashboardStructurePanelView {...workspace} surface={surface} />;
}

export function DashboardStructurePanel({ guildId }: { guildId: string }) {
    return (
        <DashboardStructureController guildId={guildId}>
            {(workspace) => <DashboardStructurePanelView {...workspace} surface='all' />}
        </DashboardStructureController>
    );
}

function DashboardStructureController({
    guildId,
    children,
}: {
    guildId: string;
    children: (workspace: DashboardStructurePanelViewProps) => ReactNode;
}) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardStructureSettingsQueryKey(guildId);
    const [importJson, setImportJson] = useState('');
    const [structurePolicy, setStructurePolicy] = useState<DashboardStructurePolicy>('synchronize');
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
    const { activeExecutionRun, executionProgress, retrySettings, settingsQuery } =
        useDashboardStructureWorkspaceQueries(guildId);
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
        refreshSettings,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardStructureDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

    async function refreshSettings(options: { resetBackups?: boolean } = {}): Promise<void> {
        if (options.resetBackups) setBackupPageState(undefined);
        await queryClient.invalidateQueries({ queryKey });
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
            await refreshSettings({ resetBackups: true });
            await refreshAuditEvents();
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
        } finally {
            setBusyAction(undefined);
        }
    }

    async function importStructureFile(file: File | undefined): Promise<void> {
        if (!file) return;

        setStatus(undefined);

        try {
            setImportJson(await file.text());
            imports.clearRoleMappings();
            setStatus({ tone: 'neutral', message: `Loaded ${file.name}. Create a deployment plan to review changes.` });
        } catch {
            setStatus({ tone: 'error', message: 'Server blueprint file could not be read.' });
        }
    }

    async function saveBackupSettings(draft?: DashboardStructureBackupSettingsValue): Promise<void> {
        const settings = settingsQuery.data?.backupSettings;
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
            await refreshSettings();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadMoreBackups(): Promise<void> {
        const freshBackups = settingsQuery.data?.backups ?? [];
        const currentPage =
            (backupPageState && isBackupPageStateFresh(backupPageState, freshBackups) ? backupPageState : undefined) ??
            (settingsQuery.data
                ? {
                      backups: freshBackups,
                      ...(settingsQuery.data.backupNextCursor
                          ? { nextCursor: settingsQuery.data.backupNextCursor }
                          : {}),
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
            await refreshSettings({ resetBackups: true });
            await refreshAuditEvents();
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
            await refreshSettings({ resetBackups: true });
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function importBackup(backup: DashboardStructureBackupSummary): Promise<void> {
        await imports.createDryRunFromBackupId({
            backupId: backup.id,
            intent: backup.source === 'restore_point' ? 'restore' : 'backup',
        });
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
                return;
            }

            setImportJson(result.backupJson);
            imports.clearRoleMappings();
            setStatus({ tone: 'neutral', message: 'Backup JSON loaded. Create a deployment plan to review changes.' });
        } finally {
            setBusyAction(undefined);
        }
    }

    if (!settingsQuery.data && settingsQuery.isPending) return <DashboardStructureLoading />;

    if (!settingsQuery.data) {
        const diagnosticCode = readDashboardStructureDiagnosticCode(settingsQuery.error);
        return (
            <DashboardStructureErrorState
                title='Server Blueprint could not load'
                message={
                    diagnosticCode === 'BLUEPRINT_LOAD_BACKEND_INCOMPATIBLE'
                        ? 'The Convex backend does not match this NeonFlux build. Deploy the matching backend before using Server Blueprint.'
                        : 'The dashboard did not receive Blueprint data. Retry the read; this does not queue or apply a deployment.'
                }
                diagnosticCode={diagnosticCode}
                onRetry={() => {
                    retrySettings();
                }}
            />
        );
    }

    const importRuns = settingsQuery.data.importRuns.map((run) => ({
        ...run,
        actions: imports.actionPagesByRunId[run.id]?.actions ?? run.actions,
        decisions: imports.decisionPagesByRunId[run.id]?.decisions ?? run.decisions,
        ...(run.id === activeExecutionRun?.id && executionProgress.execution
            ? { execution: executionProgress.execution }
            : {}),
    }));
    const latestRun = importRuns.at(0);
    const backupSettings = settingsQuery.data.backupSettings;
    const enabledDraft = backupEnabled ?? backupSettings.enabled;
    const cadenceDraft = backupCadenceWeeks ?? backupSettings.cadenceWeeks;
    const retentionDraft = backupRetentionDays ?? backupSettings.retentionDays;
    const backupPage =
        backupPageState && isBackupPageStateFresh(backupPageState, settingsQuery.data.backups)
            ? backupPageState
            : {
                  backups: settingsQuery.data.backups,
                  ...(settingsQuery.data.backupNextCursor ? { nextCursor: settingsQuery.data.backupNextCursor } : {}),
              };

    return children({
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
        explorer,
        structurePolicy,
        importJson,
        importRuns,
        latestRun,
        observedState: settingsQuery.data.observedState,
        preflightByRunId: imports.preflightByRunId,
        restoreShortcutBackupId: imports.restoreShortcutBackupId,
        roleMappingConflicts: imports.roleMappingConflicts,
        roleMappings: imports.roleMappings,
        retentionDraft,
        settingsRefreshIssue: settingsQuery.isError
            ? { code: readDashboardStructureDiagnosticCode(settingsQuery.error) }
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
        onApprovePlan: (run) => void imports.approvePlan(run),
        onCreateBackup: () => void createBackup(),
        onCreatePlan: () => void imports.createPlan(),
        onCreateRestoreDryRun: (backupId) => void imports.createDryRunFromBackupId({ backupId, intent: 'restore' }),
        onDeleteConfirmationChange: (runId, confirmation) =>
            imports.setDeleteConfirmationByRunId((current) => ({ ...current, [runId]: confirmation })),
        onDownloadCurrentStructure: () => void downloadCurrentStructure(),
        onDriftCreateDryRun: (backup) => void importBackup(backup),
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
        onLoadMoreBackups: () => void loadMoreBackups(),
        onLoadRunActions: (run) => void imports.loadRunActions(run),
        onLoadRunDecisions: (run) => void imports.loadRunDecisions(run),
        onPreflightRun: (run) => void imports.preflightImportRun(run),
        onRetryExecutionProgress: () => {
            executionProgress.retry();
        },
        onRetrySettingsRefresh: () => {
            retrySettings();
        },
        onRecoveryPlan: (run) => void imports.createRecoveryPlan(run),
        onReviewScheduledDrift: (baselineBackupId) => void driftActions.reviewScheduled(baselineBackupId),
        onSaveBackupSettings: (value) => void saveBackupSettings(value),
        onSetBackupJsonAsImportJson: () => {
            setImportJson(backupJson);
            imports.clearRoleMappings();
        },
    });
}
