import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardStructureBackupsQueryKey,
    getDashboardStructureRunsQueryKey,
    getDashboardStructureStatusQueryKey,
} from '../dashboard-query-keys.js';
import {
    deleteDashboardStructureBackupRouteData,
    readDashboardStructureBackupJsonRouteData,
    readDashboardStructureBackupPageRouteData,
    renameDashboardStructureBackupRouteData,
    saveDashboardStructureBackupSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureBackupSummary } from '../server/dashboard-structure-model.js';
import { createDashboardStructureBackupCreation } from './dashboard-structure-backup-creation.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import { useDashboardStructureBackupsQuery } from './dashboard-structure-backups-query.js';
import { DashboardStructureBackupsSurface } from './dashboard-structure-backups-surface.js';
import { createDashboardStructureDriftActions } from './dashboard-structure-drift-actions.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-json.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { isBackupPageStateFresh } from './dashboard-structure-panel-backup-state.js';
import { downloadJsonFile } from './dashboard-structure-panel-download.js';
import { formatBackupSource, formatDate } from './dashboard-structure-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { BackupPageState, PanelStatus } from './dashboard-structure-panel-types.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { createDashboardStructureRestorePlan } from './dashboard-structure-restore-plan.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';
import {
    DashboardStructurePendingSurface,
    DashboardStructureSurfaceContent,
} from './dashboard-structure-surface-state.js';

export function DashboardStructureBackupsRoute() {
    const runtime = useDashboardStructureRuntime();
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
    const backupsQuery = useDashboardStructureBackupsQuery(guildId);
    const [backupJson, setBackupJson] = useState('');
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [backupEnabled, setBackupEnabled] = useState<boolean | undefined>();
    const [backupCadenceWeeks, setBackupCadenceWeeks] = useState<number | undefined>();
    const [backupRetentionDays, setBackupRetentionDays] = useState<number | undefined>();
    const [backupPageState, setBackupPageState] = useState<BackupPageState | undefined>();
    const [editingBackupId, setEditingBackupId] = useState<string | undefined>();
    const [editingBackupName, setEditingBackupName] = useState('');
    const [deleteConfirmBackupId, setDeleteConfirmBackupId] = useState<string | undefined>();

    async function refreshBackups(options: { resetBackups?: boolean } = {}): Promise<void> {
        if (options.resetBackups) setBackupPageState(undefined);
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

    const createBackup = createDashboardStructureBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBackupJson,
        setBusyAction,
        setStatus,
    });
    const createRestorePlan = createDashboardStructureRestorePlan({
        guildId,
        refreshAuditEvents,
        refreshRuns,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardStructureDriftActions({ guildId, setBusyAction, setStatus });

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
            const result = await deleteDashboardStructureBackupRouteData({ data: { backupId: backup.id, guildId } });
            if (result.type !== 'backup-deleted') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'restore-point-protected'
                          ? { tone: 'error', message: 'Restore-point backups cannot be deleted manually.' }
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
        backup: DashboardStructureBackupSummary,
        mode: 'download' | 'inspect' | 'use'
    ): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-json:${backup.id}`);
        try {
            const result = await readDashboardStructureBackupJsonRouteData({ data: { backupId: backup.id, guildId } });
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
                setComparisonSource({
                    canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
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
        setDeployFlow({ type: 'choose' });
        setImportJson(sourceJson);
        setStructurePolicy('synchronize');
        setStatus(sourceJson ? { tone: 'neutral', message: 'Backup loaded as the deployment source.' } : undefined);
    }

    if (!backupsQuery.data && backupsQuery.isError) {
        return (
            <DashboardStructurePendingSurface
                surface='backups'
                error={{
                    diagnosticCode: readDashboardStructureDiagnosticCode(backupsQuery.error),
                    retry: () => void backupsQuery.refetch(),
                    retrying: backupsQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data) return <DashboardStructurePendingSurface surface='backups' />;

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
        <DashboardStructureSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardStructureDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || runtime.statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardStructureBackupsSurface
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
                                const run = await createRestorePlan({ backupId: backup.id, intent: 'restore' });
                                if (!run) return;
                                setDeployFlow({ type: 'run', run });
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
        </DashboardStructureSurfaceContent>
    );
}
