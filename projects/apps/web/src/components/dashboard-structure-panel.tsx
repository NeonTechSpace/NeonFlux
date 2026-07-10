import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { createContext, use, useState } from 'react';
import type { ReactNode } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardStructureSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    downloadDashboardStructureExportRouteData,
    exportDashboardStructureRouteData,
    deleteDashboardStructureBackupRouteData,
    readDashboardStructureBackupPageRouteData,
    readDashboardStructureBackupJsonRouteData,
    readDashboardStructureDriftRouteData,
    readDashboardStructureSettingsRouteData,
    renameDashboardStructureBackupRouteData,
    saveDashboardStructureBackupSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureBackupSummary } from '../server/dashboard-structure.server.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-diff.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { isBackupPageStateFresh } from './dashboard-structure-panel-backup-state.js';
import { downloadJsonFile } from './dashboard-structure-panel-download.js';
import { useDashboardStructureExplorerState } from './dashboard-structure-panel-explorer-state.js';
import { formatBackupSource, formatCounts, formatDate } from './dashboard-structure-panel-format.js';
import { useDashboardStructureImportState } from './dashboard-structure-panel-import-state.js';
import { DashboardStructureLoading } from './dashboard-structure-panel-shared.js';
import { countPlanChanges, toDriftErrorStatus, toErrorStatus } from './dashboard-structure-panel-status.js';
import type { BackupPageState, DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import { DashboardStructurePanelView } from './dashboard-structure-panel-view.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import type {
    DashboardStructurePanelViewProps,
    DashboardStructureSurface,
} from './dashboard-structure-panel-view.js';

const structureLiveArea = ['import_export', 'structure'] as const;
const DashboardStructureWorkspaceContext = createContext<DashboardStructurePanelViewProps | undefined>(undefined);

const blueprintNavigation = [
    { id: 'current', label: 'Current', to: '/dashboard/$guildId/structure/current' },
    { id: 'backups', label: 'Backups', to: '/dashboard/$guildId/structure/backups' },
    { id: 'compare', label: 'Compare', to: '/dashboard/$guildId/structure/compare' },
    { id: 'deploy', label: 'Deploy', to: '/dashboard/$guildId/structure/deploy' },
    { id: 'runs', label: 'Runs', to: '/dashboard/$guildId/structure/runs' },
] as const;

export function DashboardStructureWorkspace({ guildId }: { guildId: string }) {
    useDashboardLiveInvalidation({
        guildId,
        areas: structureLiveArea,
    });

    return (
        <DashboardStructureController guildId={guildId}>
            {(workspace) => (
                <DashboardStructureWorkspaceContext value={workspace}>
                    <section className='min-w-0' aria-labelledby='server-blueprint-title'>
                        <header className='sticky top-0 z-10 border-b border-[var(--dash-border)] bg-[rgba(7,8,11,0.94)] px-1 backdrop-blur-md'>
                            <div className='flex min-h-14 items-center justify-between gap-5'>
                                <h2
                                    id='server-blueprint-title'
                                    className='text-xl font-semibold tracking-tight text-[var(--dash-text)]'>
                                    Server Blueprint
                                </h2>
                                <p className='hidden text-sm text-[var(--dash-text-muted)] 2xl:block'>
                                    Capture versions, understand differences, and apply reviewed changes.
                                </p>
                            </div>
                            <nav className='flex min-w-0 gap-6 overflow-x-auto' aria-label='Server Blueprint tools'>
                                {blueprintNavigation.map((item) => (
                                    <Link
                                        key={item.id}
                                        to={item.to}
                                        params={{ guildId }}
                                        className='relative shrink-0 py-3 text-sm font-medium text-[var(--dash-text-muted)] transition-colors hover:text-[var(--dash-text)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)]'
                                        activeProps={{ className: 'text-[var(--dash-text)]' }}>
                                        {({ isActive }) => (
                                            <>
                                                {item.label}
                                                {isActive ? (
                                                    <motion.span
                                                        layoutId='server-blueprint-active-tool'
                                                        className='absolute inset-x-0 bottom-0 h-0.5 bg-[var(--dash-primary)]'
                                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                                    />
                                                ) : null}
                                            </>
                                        )}
                                    </Link>
                                ))}
                            </nav>
                        </header>
                        <div className='pt-5'>
                            <Outlet />
                        </div>
                    </section>
                </DashboardStructureWorkspaceContext>
            )}
        </DashboardStructureController>
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
    const [replaceImportMode, setReplaceImportMode] = useState(false);
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
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardStructureSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') throw new Error('Could not load server blueprint tools.');

            return result;
        },
    });
    const explorer = useDashboardStructureExplorerState({
        driftState,
        guildId,
        importJson,
        setBusyAction,
        setStatus,
    });
    const imports = useDashboardStructureImportState({
        guildId,
        importMode: replaceImportMode ? 'replace' : 'merge',
        importJson,
        refreshAuditEvents,
        refreshSettings,
        setBusyAction,
        setStatus,
    });

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
            setStatus({ tone: 'neutral', message: `Loaded ${file.name}. Create a dry-run to review changes.` });
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
            setStatus({ tone: 'neutral', message: 'Backup JSON loaded. Create a dry-run to review changes.' });
        } finally {
            setBusyAction(undefined);
        }
    }

    async function runDriftCheck(input: { baselineBackupId?: string; busyAction: StructureBusyAction }): Promise<void> {
        setStatus(undefined);
        setBusyAction(input.busyAction);

        try {
            const result = await readDashboardStructureDriftRouteData({
                data: {
                    guildId,
                    ...(input.baselineBackupId ? { baselineBackupId: input.baselineBackupId } : {}),
                },
            });

            if (result.type !== 'structure-drift') {
                setDriftState(undefined);
                setStatus(toDriftErrorStatus(result.type));
                return;
            }

            setDriftState(result);
            const count = countPlanChanges(result.summary);
            setStatus(
                count === 0
                    ? { tone: 'success', message: `Live server matches ${result.baseline.name}.` }
                    : {
                          tone: 'neutral',
                          message: `Drift check found ${count} server layout change${
                              count === 1 ? '' : 's'
                          } against ${result.baseline.name}.`,
                      }
            );
        } finally {
            setBusyAction(undefined);
        }
    }

    async function checkDrift(backup?: DashboardStructureBackupSummary): Promise<void> {
        await runDriftCheck({
            ...(backup ? { baselineBackupId: backup.id } : {}),
            busyAction: backup ? `backup-drift:${backup.id}` : 'drift',
        });
    }

    async function reviewScheduledDrift(baselineBackupId: string): Promise<void> {
        await runDriftCheck({
            baselineBackupId,
            busyAction: 'drift',
        });
    }

    if (settingsQuery.isPending) return <DashboardStructureLoading />;

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Import / Export</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load server blueprint tools.</p>
            </article>
        );
    }

    const importRuns = settingsQuery.data.importRuns.map((run) => ({
        ...run,
        actions: imports.actionPagesByRunId[run.id]?.actions ?? run.actions,
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
        applyConfirmationByRunId: imports.applyConfirmationByRunId,
        backupJson,
        backupPage,
        backupSettings,
        busyAction,
        cadenceDraft,
        confirmationByRunId: imports.confirmationByRunId,
        deleteConfirmBackupId,
        deleteConfirmationByRunId: imports.deleteConfirmationByRunId,
        driftState,
        editingBackupId,
        editingBackupName,
        enabledDraft,
        explorer,
        replaceImportMode,
        importJson,
        importRuns,
        latestRun,
        observedState: settingsQuery.data.observedState,
        preflightByRunId: imports.preflightByRunId,
        restoreShortcutBackupId: imports.restoreShortcutBackupId,
        retentionDraft,
        status,
        onApplyConfirmationChange: (runId, confirmation) =>
            imports.setApplyConfirmationByRunId((current) => ({ ...current, [runId]: confirmation })),
        onApplyRun: (run) => void imports.applyImportRun(run),
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
        onCheckBackupDrift: (backup) => void checkDrift(backup),
        onCheckLatestDrift: () => void checkDrift(),
        onConfirmRun: (run) => void imports.confirmImportRun(run),
        onCreateBackup: () => void createBackup(),
        onCreateDryRun: () => void imports.createDryRun(),
        onCreateRestoreDryRun: (backupId) =>
            void imports.createDryRunFromBackupId({ backupId, intent: 'restore' }),
        onDeleteConfirmationChange: (runId, confirmation) =>
            imports.setDeleteConfirmationByRunId((current) => ({ ...current, [runId]: confirmation })),
        onDownloadCurrentStructure: () => void downloadCurrentStructure(),
        onDriftCreateDryRun: (backup) => void importBackup(backup),
        onImportJsonChange: setImportJson,
        onReplaceImportModeChange: setReplaceImportMode,
        onImportStructureFile: importStructureFile,
        onLoadMoreBackups: () => void loadMoreBackups(),
        onLoadRunActions: (run) => void imports.loadRunActions(run),
        onPreflightRun: (run) => void imports.preflightImportRun(run),
        onConfirmationChange: (runId, confirmation) =>
            imports.setConfirmationByRunId((current) => ({ ...current, [runId]: confirmation })),
        onRetryRun: (run) => void imports.retryImportRun(run),
        onReviewScheduledDrift: (baselineBackupId) => void reviewScheduledDrift(baselineBackupId),
        onSaveBackupSettings: (value) => void saveBackupSettings(value),
        onSetBackupJsonAsImportJson: () => setImportJson(backupJson),
    });
}
