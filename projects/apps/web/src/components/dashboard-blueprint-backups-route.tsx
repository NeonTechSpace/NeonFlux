import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardBlueprintBackupsQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import {
    deleteDashboardBlueprintBackupRouteData,
    readDashboardBlueprintBackupJsonRouteData,
    readDashboardBlueprintBackupPageRouteData,
    renameDashboardBlueprintBackupRouteData,
    saveDashboardBlueprintBackupSettingsRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintBackupSummary } from '../server/dashboard-blueprint-model.js';
import { createDashboardBlueprintBackupCreation } from './dashboard-blueprint-backup-creation.js';
import type { DashboardBlueprintBackupSettingsValue } from './dashboard-blueprint-backup-settings.js';
import { useDashboardBlueprintBackupsQuery } from './dashboard-blueprint-backups-query.js';
import { DashboardBlueprintBackupsSurface } from './dashboard-blueprint-backups-surface.js';
import { createDashboardBlueprintDriftActions } from './dashboard-blueprint-drift-actions.js';
import { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';
import { parseDashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-snapshot.js';
import type { BlueprintBusyAction, BackupPageState, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { isBackupPageStateFresh } from './dashboard-blueprint-panel-backup-state.js';
import { downloadJsonFile } from './dashboard-blueprint-panel-download.js';
import { formatBackupSource, formatDate } from './dashboard-blueprint-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import { readDashboardBlueprintDiagnosticCode } from './dashboard-blueprint-progress.js';
import { createDashboardBlueprintRestorePlan } from './dashboard-blueprint-restore-plan.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';
import {
    DashboardBlueprintPendingSurface,
    DashboardBlueprintSurfaceContent,
} from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintBackupsRoute() {
    const runtime = useDashboardBlueprintRuntime();
    const {
        guildId,
        navigateToSurface,
        retryStatus,
        setComparisonSource,
        setDeployFlow,
        setImportJson,
        setStructurePolicy,
        statusError,
    } = runtime;
    const queryClient = useQueryClient();
    const backupsQuery = useDashboardBlueprintBackupsQuery(guildId);
    const [backupJson, setBackupJson] = useState('');
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<BlueprintBusyAction | undefined>();
    const [backupEnabled, setBackupEnabled] = useState<boolean | undefined>();
    const [backupCadenceWeeks, setBackupCadenceWeeks] = useState<number | undefined>();
    const [backupRetentionDays, setBackupRetentionDays] = useState<number | undefined>();
    const [backupPageState, setBackupPageState] = useState<BackupPageState | undefined>();
    const [editingBackupId, setEditingBackupId] = useState<string | undefined>();
    const [editingBackupName, setEditingBackupName] = useState('');
    const [deleteConfirmBackupId, setDeleteConfirmBackupId] = useState<string | undefined>();

    async function refreshBackups(options: { resetBackups?: boolean } = {}): Promise<void> {
        if (options.resetBackups) setBackupPageState(undefined);
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

    const createBackup = createDashboardBlueprintBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBackupJson,
        setBusyAction,
        setStatus,
    });
    const createRestorePlan = createDashboardBlueprintRestorePlan({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardBlueprintDriftActions({ guildId, setBusyAction, setStatus });

    async function saveBackupSettings(draft?: DashboardBlueprintBackupSettingsValue): Promise<void> {
        const settings = backupsQuery.data?.backupSettings;
        const enabled = draft?.enabled ?? backupEnabled ?? settings?.enabled ?? false;
        const cadenceWeeks = draft?.cadenceWeeks ?? backupCadenceWeeks ?? settings?.cadenceWeeks ?? 1;
        const retentionDays = draft?.retentionDays ?? backupRetentionDays ?? settings?.retentionDays ?? 180;
        setStatus(undefined);
        setBusyAction('backup-settings');

        try {
            const result = await saveDashboardBlueprintBackupSettingsRouteData({
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
                    ? `Automatic backups enabled every ${result.backupSettings.cadenceWeeks} week${result.backupSettings.cadenceWeeks === 1 ? '' : 's'}.`
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
            const result = await readDashboardBlueprintBackupPageRouteData({
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

    async function renameBackup(backup: DashboardBlueprintBackupSummary): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-rename:${backup.id}`);
        try {
            const result = await renameDashboardBlueprintBackupRouteData({
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

    async function deleteBackup(backup: DashboardBlueprintBackupSummary): Promise<void> {
        if (deleteConfirmBackupId !== backup.id) {
            setDeleteConfirmBackupId(backup.id);
            return;
        }
        setStatus(undefined);
        setBusyAction(`backup-delete:${backup.id}`);
        try {
            const result = await deleteDashboardBlueprintBackupRouteData({ data: { backupId: backup.id, guildId } });
            if (result.type !== 'backup-deleted') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'restore-point-recovery-window-active'
                          ? {
                                tone: 'error',
                                message: 'Restore points are kept for at least 30 days before they can be deleted.',
                            }
                          : result.type === 'restore-point-run-active'
                            ? {
                                  tone: 'error',
                                  message: 'This restore point is still required by an active or recoverable run.',
                              }
                            : toErrorStatus(result.type)
                );
                return;
            }
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

    async function loadBackupJson(
        backup: DashboardBlueprintBackupSummary,
        mode: 'download' | 'inspect' | 'use'
    ): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-json:${backup.id}`);
        try {
            const result = await readDashboardBlueprintBackupJsonRouteData({ data: { backupId: backup.id, guildId } });
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
                const snapshot = parseDashboardBlueprintExplorerSnapshot(result.backupJson);
                if (!snapshot) {
                    setStatus({ tone: 'error', message: 'Backup JSON could not be parsed for the explorer.' });
                    return;
                }
                setComparisonSource({
                    canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
                    detail: `${formatBackupSource(backup.source)} · ${formatDate(backup.completedAt)}`,
                    label: backup.name,
                    snapshot,
                    type: 'backup',
                });
                await navigateToSurface('compare');
                return;
            }
            beginDeploySource(result.backupJson);
            await navigateToSurface('deploy');
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    function beginDeploySource(sourceJson = ''): void {
        setDeployFlow({ type: 'draft', step: 'source' });
        setImportJson(sourceJson);
        setStructurePolicy('synchronize');
        setStatus(sourceJson ? { tone: 'neutral', message: 'Backup loaded as the deployment source.' } : undefined);
    }

    if (!backupsQuery.data && backupsQuery.isError) {
        return (
            <DashboardBlueprintPendingSurface
                surface='backups'
                error={{
                    diagnosticCode: readDashboardBlueprintDiagnosticCode(backupsQuery.error),
                    retry: () => void backupsQuery.refetch(),
                    retrying: backupsQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data) return <DashboardBlueprintPendingSurface surface='backups' />;

    const backupSettings = backupsQuery.data.backupSettings;
    const backupPage =
        backupPageState && isBackupPageStateFresh(backupPageState, backupsQuery.data.backups)
            ? backupPageState
            : {
                  backups: backupsQuery.data.backups,
                  ...(backupsQuery.data.backupNextCursor ? { nextCursor: backupsQuery.data.backupNextCursor } : {}),
              };
    const refreshError = backupsQuery.isError ? backupsQuery.error : statusError;

    return (
        <DashboardBlueprintSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintBackupsSurface
                workspace={{
                    backupJson,
                    backupPage,
                    backupSettings,
                    busyAction,
                    cadenceDraft: backupCadenceWeeks ?? backupSettings.cadenceWeeks,
                    deleteConfirmBackupId,
                    editingBackupId,
                    editingBackupName,
                    enabledDraft: backupEnabled ?? backupSettings.enabled,
                    retentionDraft: backupRetentionDays ?? backupSettings.retentionDays,
                    onBackupCadenceWeeksChange: setBackupCadenceWeeks,
                    onBackupDelete: (backup) => void deleteBackup(backup),
                    onBackupDownload: (backup) => void loadBackupJson(backup, 'download'),
                    onBackupEnabledChange: setBackupEnabled,
                    onBackupImport: (backup) => {
                        void (async () => {
                            if (backup.source === 'restore_point') {
                                const plan = await createRestorePlan({ backupId: backup.id, intent: 'restore' });
                                if (!plan) return;
                                setDeployFlow({ type: 'plan', plan });
                                await navigateToSurface('deploy');
                            } else {
                                await loadBackupJson(backup, 'use');
                            }
                        })();
                    },
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
                    onCreateBackup: () => void createBackup(),
                    onLoadMoreBackups: () => void loadMoreBackups(),
                    onSaveBackupSettings: (value) => void saveBackupSettings(value),
                    onSetBackupJsonAsImportJson: () => {
                        beginDeploySource(backupJson);
                        void navigateToSurface('deploy');
                    },
                }}
            />
        </DashboardBlueprintSurfaceContent>
    );
}
