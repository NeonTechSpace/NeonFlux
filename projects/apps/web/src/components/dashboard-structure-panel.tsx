import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Download, Eye, GitCompareArrows, Pencil, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardStructureSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
    createDashboardStructureDryRunRouteData,
    downloadDashboardStructureExportRouteData,
    exportDashboardStructureRouteData,
    deleteDashboardStructureBackupRouteData,
    preflightDashboardStructureImportRunRouteData,
    importDashboardStructureBackupRouteData,
    readDashboardStructureBackupPageRouteData,
    readDashboardStructureBackupJsonRouteData,
    readDashboardStructureDriftRouteData,
    readDashboardStructureImportActionPageRouteData,
    readDashboardStructureSettingsRouteData,
    renameDashboardStructureBackupRouteData,
    retryDashboardStructureImportRunRouteData,
    saveDashboardStructureBackupSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureDriftResult,
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import {
    buildDashboardStructureBackupRowId,
    deriveDashboardStructureBackupHealth,
} from './dashboard-structure-backup-health.js';
import {
    DashboardStructureExplorer,
    readDashboardStructureExplorerActionEntityKey,
} from './dashboard-structure-explorer.js';
import type {
    DashboardStructureExplorerComparisonTarget,
    DashboardStructureExplorerOverlayMode,
    DashboardStructureExplorerSource,
} from './dashboard-structure-explorer.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-diff.js';
import {
    parseDashboardStructureExplorerSnapshot,
    readDashboardStructureExplorerEntityKey,
} from './dashboard-structure-explorer-model.js';
import type { DashboardStructureExplorerEntityKey } from './dashboard-structure-explorer-model.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';

type PanelStatus = {
    tone: 'success' | 'error' | 'neutral';
    message: string;
};

type ActionPageState = {
    actions: DashboardStructureImportAction[];
    nextCursor?: string;
};

type BackupPageState = {
    backups: DashboardStructureBackupSummary[];
    nextCursor?: string;
};

type DriftState = Extract<DashboardStructureDriftResult, { type: 'structure-drift' }>;

const emptyExplorerComparisonTarget: DashboardStructureExplorerComparisonTarget = {
    label: 'No comparison',
    type: 'none',
};
const emptyPlanSummary = {
    creates: 0,
    updates: 0,
    deletes: 0,
    roles: 0,
    categories: 0,
    channels: 0,
};

export function DashboardStructurePanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardStructureSettingsQueryKey(guildId);
    const [importJson, setImportJson] = useState('');
    const [backupJson, setBackupJson] = useState('');
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [backupEnabled, setBackupEnabled] = useState<boolean | undefined>();
    const [backupCadenceWeeks, setBackupCadenceWeeks] = useState<number | undefined>();
    const [backupRetentionDays, setBackupRetentionDays] = useState<number | undefined>();
    const [backupPageState, setBackupPageState] = useState<BackupPageState | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();
    const [explorerSource, setExplorerSource] = useState<DashboardStructureExplorerSource>({
        label: 'No snapshot',
        type: 'none',
    });
    const [explorerComparisonTarget, setExplorerComparisonTarget] =
        useState<DashboardStructureExplorerComparisonTarget>(emptyExplorerComparisonTarget);
    const [explorerOverlayMode, setExplorerOverlayMode] = useState<DashboardStructureExplorerOverlayMode>('none');
    const [selectedExplorerEntityKey, setSelectedExplorerEntityKey] = useState<
        DashboardStructureExplorerEntityKey | undefined
    >();
    const [editingBackupId, setEditingBackupId] = useState<string | undefined>();
    const [editingBackupName, setEditingBackupName] = useState('');
    const [deleteConfirmBackupId, setDeleteConfirmBackupId] = useState<string | undefined>();
    const [actionPagesByRunId, setActionPagesByRunId] = useState<Partial<Record<string, ActionPageState>>>({});
    const [confirmationByRunId, setConfirmationByRunId] = useState<Record<string, string>>({});
    const [applyConfirmationByRunId, setApplyConfirmationByRunId] = useState<Record<string, string>>({});
    const [deleteConfirmationByRunId, setDeleteConfirmationByRunId] = useState<Record<string, string>>({});
    const [preflightByRunId, setPreflightByRunId] = useState<Record<string, DashboardStructurePreflightReport>>({});
    const [restoreShortcutBackupId, setRestoreShortcutBackupId] = useState<string | undefined>();
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardStructureSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') throw new Error('Could not load server blueprint tools.');

            return result;
        },
    });
    async function refreshSettings(options: { resetBackups?: boolean } = {}): Promise<void> {
        if (options.resetBackups) setBackupPageState(undefined);
        await queryClient.invalidateQueries({ queryKey });
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    function setExplorerSourceAndResetComparison(source: DashboardStructureExplorerSource): void {
        setExplorerSource(source);
        setExplorerComparisonTarget(emptyExplorerComparisonTarget);
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

    async function loadLiveExplorerSnapshot(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-live');

        try {
            const result = await downloadDashboardStructureExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerSourceAndResetComparison({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                label: 'Live server layout',
                snapshot,
                type: 'live',
                ...(snapshot.exportedAt ? { detail: `Read ${formatDate(snapshot.exportedAt)}` } : {}),
            });
            setSelectedExplorerEntityKey(undefined);
            setStatus({ tone: 'success', message: 'Live server blueprint loaded in explorer.' });
        } finally {
            setBusyAction(undefined);
        }
    }

    function inspectImportJson(): void {
        setStatus(undefined);

        const snapshot = parseDashboardStructureExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            label: 'Import JSON',
            snapshot,
            type: 'import-json',
            ...(snapshot.exportedAt ? { detail: `Exported ${formatDate(snapshot.exportedAt)}` } : {}),
        });
        setSelectedExplorerEntityKey(undefined);
        setStatus({ tone: 'neutral', message: 'Import JSON loaded in explorer.' });
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

    async function saveBackupSettings(): Promise<void> {
        const settings = settingsQuery.data?.backupSettings;
        const enabled = backupEnabled ?? settings?.enabled ?? false;
        const cadenceWeeks = backupCadenceWeeks ?? settings?.cadenceWeeks ?? 1;
        const retentionDays = backupRetentionDays ?? settings?.retentionDays ?? 180;

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
        const currentPage = backupPageState;
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
                backups: [...(current?.backups ?? []), ...result.page.backups],
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
            await refreshSettings();
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
            await refreshSettings();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createDryRunFromBackupId({
        backupId,
        intent = 'backup',
    }: {
        backupId: string;
        intent?: 'backup' | 'restore';
    }): Promise<void> {
        setStatus(undefined);
        setBusyAction(`backup-import:${backupId}`);

        try {
            const result = await importDashboardStructureBackupRouteData({
                data: { backupId, guildId },
            });

            if (result.type !== 'backup-import-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'backup-json-unavailable'
                          ? { tone: 'error', message: 'This backup does not have server blueprint JSON.' }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message:
                    intent === 'restore'
                        ? `Restore dry-run created with ${result.importRun.actionCount} planned changes. Review it before applying.`
                        : `Dry-run created from backup with ${result.importRun.actionCount} planned changes.`,
            });
            await refreshSettings();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function importBackup(backup: DashboardStructureBackupSummary): Promise<void> {
        await createDryRunFromBackupId({
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

                setExplorerSourceAndResetComparison({
                    canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                    detail: `${formatBackupSource(backup.source)} · ${formatDate(backup.completedAt)}`,
                    label: backup.name,
                    snapshot,
                    type: 'backup',
                });
                setSelectedExplorerEntityKey(undefined);
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

    function compareExplorerImportJson(): void {
        setStatus(undefined);

        const snapshot = parseDashboardStructureExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            label: 'Import JSON',
            snapshot,
            type: 'import-json',
            ...(snapshot.exportedAt ? { detail: `Exported ${formatDate(snapshot.exportedAt)}` } : {}),
        });
        setStatus({ tone: 'neutral', message: 'Import JSON comparison loaded.' });
    }

    async function compareExplorerLive(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-compare-live');

        try {
            const result = await downloadDashboardStructureExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                label: 'Live server layout',
                snapshot,
                type: 'live',
                ...(snapshot.exportedAt ? { detail: `Read ${formatDate(snapshot.exportedAt)}` } : {}),
            });
            setStatus({ tone: 'neutral', message: 'Live server blueprint comparison loaded.' });
        } finally {
            setBusyAction(undefined);
        }
    }

    async function compareExplorerDriftBaseline(): Promise<void> {
        const baseline = driftState?.baseline;
        if (!baseline || baseline.status !== 'succeeded') return;

        setStatus(undefined);
        setBusyAction('explorer-compare-baseline');

        try {
            const result = await readDashboardStructureBackupJsonRouteData({
                data: { backupId: baseline.id, guildId },
            });

            if (result.type !== 'backup-json') {
                setStatus(
                    result.type === 'backup-json-unavailable'
                        ? { tone: 'error', message: 'This backup does not have server blueprint JSON.' }
                        : toErrorStatus(result.type)
                );
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.backupJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Backup JSON could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                detail: `${formatBackupSource(baseline.source)} · ${formatDate(baseline.completedAt)}`,
                label: baseline.name,
                snapshot,
                type: 'backup',
            });
            setStatus({ tone: 'neutral', message: 'Drift baseline comparison loaded.' });
        } finally {
            setBusyAction(undefined);
        }
    }

    function inspectRequestedFinalState(run: DashboardStructureImportRun): void {
        setStatus(undefined);

        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({
                tone: 'error',
                message: 'This dry-run does not include a requested final-state snapshot.',
            });
            return;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            detail: `Dry-run ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setSelectedExplorerEntityKey(undefined);
        setStatus({
            tone: 'neutral',
            message: 'Requested final state loaded. This is the dry-run target, not the current server state.',
        });
    }

    function compareExplorerRequestedFinalState(run: DashboardStructureImportRun): void {
        setStatus(undefined);

        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({
                tone: 'error',
                message: 'This dry-run does not include a requested final-state snapshot.',
            });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            detail: `Dry-run ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setStatus({
            tone: 'neutral',
            message: 'Requested final-state comparison loaded. This is the dry-run target, not applied state.',
        });
    }

    function selectDriftAction(action: DriftState['previewActions'][number]): void {
        setExplorerOverlayMode('drift');
        setSelectedExplorerEntityKey(readDashboardStructureExplorerEntityKey(action));
    }

    function selectImportAction(run: DashboardStructureImportRun, action: DashboardStructureImportAction): void {
        setExplorerOverlayMode(`run:${run.id}`);
        setSelectedExplorerEntityKey(readDashboardStructureExplorerActionEntityKey(action));
    }

    async function confirmImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`confirm:${run.id}`);

        try {
            const result = await confirmDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    confirmationText: confirmationByRunId[run.id] ?? '',
                },
            });

            if (result.type !== 'confirmed') {
                setStatus(toRunActionStatus(result));
                return;
            }

            setConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({ tone: 'success', message: 'Dry-run confirmed. No server changes were applied.' });
            await refreshSettings();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function preflightImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`preflight:${run.id}`);

        try {
            const result = await preflightDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                },
            });

            if (result.type !== 'preflight') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-preflightable'
                          ? {
                                tone: 'error',
                                message: `This dry-run is ${formatStatus(result.status)} and cannot be preflighted.`,
                            }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setPreflightByRunId((current) => ({ ...current, [run.id]: result.report }));
            setStatus({
                tone: 'neutral',
                message: `Preflight checked ${result.report.summary.total} planned changes. No server changes were applied.`,
            });
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function applyImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setRestoreShortcutBackupId(undefined);
        setBusyAction(`apply:${run.id}`);

        try {
            const result = await applyDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    confirmationText: applyConfirmationByRunId[run.id] ?? '',
                    ...(deleteConfirmationByRunId[run.id]
                        ? { destructiveConfirmationText: deleteConfirmationByRunId[run.id] }
                        : {}),
                },
            });

            if (result.type !== 'applied' && result.type !== 'failed') {
                setStatus(toApplyErrorStatus(result));
                return;
            }

            setRestoreShortcutBackupId(result.restorePointBackupId);
            setApplyConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setDeleteConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: result.type === 'applied' ? 'success' : 'error',
                message:
                    result.type === 'applied'
                        ? `Applied ${result.importRun.actionCount} server layout updates.`
                        : 'Server blueprint apply finished with failures. Review action statuses before retrying.',
            });
            await refreshSettings();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createDryRun(): Promise<void> {
        setStatus(undefined);
        setBusyAction('dry-run');

        try {
            const result = await createDashboardStructureDryRunRouteData({
                data: {
                    guildId,
                    backupJson: importJson,
                },
            });

            if (result.type !== 'dry-run-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message: `Dry-run created with ${result.importRun.actionCount} planned changes.`,
            });
            await refreshSettings();
            await refreshAuditEvents();
            await refreshAuditEvents();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadRunActions(run: DashboardStructureImportRun): Promise<void> {
        setBusyAction(`actions:${run.id}`);

        try {
            const currentPage: ActionPageState | undefined = actionPagesByRunId[run.id];
            const result = await readDashboardStructureImportActionPageRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    ...(currentPage?.nextCursor ? { cursor: currentPage.nextCursor } : {}),
                    limit: 100,
                },
            });

            if (result.type !== 'action-page') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => {
                const existingPage: ActionPageState | undefined = current[run.id];

                return {
                    ...current,
                    [run.id]: {
                        actions: [...(existingPage?.actions ?? []), ...result.page.actions],
                        ...(result.page.nextCursor ? { nextCursor: result.page.nextCursor } : {}),
                    },
                };
            });
        } finally {
            setBusyAction(undefined);
        }
    }

    async function retryImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`retry:${run.id}`);

        try {
            const result = await retryDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                },
            });

            if (result.type !== 'retry-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-retryable'
                          ? {
                                tone: 'error',
                                message: `This run is ${formatStatus(result.status)} and cannot be retried.`,
                            }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message: `Retry dry-run created with ${result.importRun.actionCount} failed action${
                    result.importRun.actionCount === 1 ? '' : 's'
                }.`,
            });
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
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
        actions: actionPagesByRunId[run.id]?.actions ?? run.actions,
    }));
    const latestRun = importRuns.at(0);
    const backupSettings = settingsQuery.data.backupSettings;
    const enabledDraft = backupEnabled ?? backupSettings.enabled;
    const cadenceDraft = backupCadenceWeeks ?? backupSettings.cadenceWeeks;
    const retentionDraft = backupRetentionDays ?? backupSettings.retentionDays;
    const backupPage = backupPageState ?? {
        backups: settingsQuery.data.backups,
        ...(settingsQuery.data.backupNextCursor ? { nextCursor: settingsQuery.data.backupNextCursor } : {}),
    };

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Import / Export</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Back up server layout, dry-run imports, preflight confirmed runs, and apply supported role, channel,
                    category, and permission changes.
                </p>
                {settingsQuery.data.observedState.observedChangeCount > 0 ? (
                    <p className='mt-2 text-sm leading-6 text-sky-200'>
                        {formatObservedState(settingsQuery.data.observedState)}
                    </p>
                ) : null}
            </div>

            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(22rem,32rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='structure-tools-heading'>
                    <h4 id='structure-tools-heading' className='text-sm font-semibold text-white'>
                        Server blueprint tools
                    </h4>
                    <BackupSettings
                        settings={backupSettings}
                        enabled={enabledDraft}
                        cadenceWeeks={cadenceDraft}
                        retentionDays={retentionDraft}
                        busy={busyAction === 'backup-settings'}
                        onEnabledChange={setBackupEnabled}
                        onCadenceWeeksChange={setBackupCadenceWeeks}
                        onRetentionDaysChange={setBackupRetentionDays}
                        onSave={() => void saveBackupSettings()}
                    />
                    <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                                <p className='text-sm font-semibold text-white'>Create manual backup</p>
                                <p className='mt-1 text-xs leading-5 text-neutral-400'>
                                    Reads roles, categories, channels, and permission overwrites.
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={() => void createBackup()}
                                disabled={Boolean(busyAction)}
                                className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                {busyAction === 'backup' ? 'Creating' : 'Create backup'}
                            </button>
                        </div>
                        {backupJson ? (
                            <div className='mt-3 space-y-2'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-xs font-medium text-neutral-300'>Latest backup JSON</p>
                                    <button
                                        type='button'
                                        onClick={() => setImportJson(backupJson)}
                                        className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-200 transition hover:border-sky-400 hover:text-sky-200'>
                                        Use for dry-run
                                    </button>
                                </div>
                                <textarea
                                    value={backupJson}
                                    readOnly
                                    rows={8}
                                    className='w-full resize-y rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-300 outline-none'
                                />
                            </div>
                        ) : null}
                    </div>

                    <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                                <p className='text-sm font-semibold text-white'>Download current blueprint</p>
                                <p className='mt-1 text-xs leading-5 text-neutral-400'>
                                    Exports import-ready JSON without creating a backup record.
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={() => void downloadCurrentStructure()}
                                disabled={Boolean(busyAction)}
                                className='min-h-10 rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-200 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-500'>
                                {busyAction === 'export' ? 'Downloading' : 'Download JSON'}
                            </button>
                        </div>
                    </div>

                    <div className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <label htmlFor='server-blueprint-import-json'>Import JSON dry-run</label>
                            <button
                                type='button'
                                onClick={inspectImportJson}
                                disabled={Boolean(busyAction)}
                                className='min-h-8 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                Inspect import JSON
                            </button>
                        </div>
                        <textarea
                            id='server-blueprint-import-json'
                            value={importJson}
                            onChange={(event) => setImportJson(event.currentTarget.value)}
                            rows={12}
                            spellCheck={false}
                            className='w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='Paste server blueprint JSON from a backup or current-state download.'
                        />
                    </div>
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Import JSON file</span>
                        <input
                            type='file'
                            accept='application/json,.json'
                            onChange={(event) => {
                                void importStructureFile(event.currentTarget.files?.[0]);
                                event.currentTarget.value = '';
                            }}
                            className='block w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-neutral-100 hover:file:bg-neutral-700'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={() => void createDryRun()}
                        disabled={Boolean(busyAction)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {busyAction === 'dry-run' ? 'Creating dry-run' : 'Create dry-run'}
                    </button>
                    {status ? <StatusMessage status={status} /> : null}
                    {restoreShortcutBackupId ? (
                        <RestorePointShortcutNotice
                            backupId={restoreShortcutBackupId}
                            busy={busyAction === `backup-import:${restoreShortcutBackupId}`}
                            disabled={Boolean(busyAction)}
                            onCreateRestoreDryRun={(backupId) =>
                                void createDryRunFromBackupId({ backupId, intent: 'restore' })
                            }
                        />
                    ) : null}
                    <p className='text-xs leading-5 text-neutral-500'>
                        Applies supported creates, deletes, role name/color/hoist/mentionability/permission/position
                        updates, channel/category name, position, parent, and permission-overwrite updates. Topic, NSFW,
                        slowmode, type changes, and moving @everyone are blocked.
                    </p>
                </section>

                <section className='space-y-5 p-4' aria-labelledby='structure-history-heading'>
                    <div>
                        <h4 id='structure-history-heading' className='text-sm font-semibold text-white'>
                            Recent blueprint history
                        </h4>
                        <p className='mt-1 text-xs leading-5 text-neutral-400'>
                            Backups and dry-runs are scoped to this server.
                        </p>
                    </div>
                    <BackupStatus
                        backups={backupPage.backups}
                        observedState={settingsQuery.data.observedState}
                        settings={backupSettings}
                    />
                    <DriftPanel
                        drift={driftState}
                        settings={backupSettings}
                        busyAction={busyAction}
                        onCheckLatest={() => void checkDrift()}
                        onCreateBackup={() => void createBackup()}
                        onCreateDryRun={(backup) => void importBackup(backup)}
                        onReviewScheduledDrift={(baselineBackupId) => void reviewScheduledDrift(baselineBackupId)}
                        onSelectAction={selectDriftAction}
                    />
                    <DashboardStructureExplorer
                        busyAction={busyAction}
                        drift={driftState}
                        overlayMode={explorerOverlayMode}
                        preflightByRunId={preflightByRunId}
                        runs={importRuns}
                        selectedEntityKey={selectedExplorerEntityKey}
                        comparisonTarget={explorerComparisonTarget}
                        source={explorerSource}
                        onCompareDriftBaseline={() => void compareExplorerDriftBaseline()}
                        onCompareImportJson={compareExplorerImportJson}
                        onCompareLive={() => void compareExplorerLive()}
                        onCompareRequestedFinalState={compareExplorerRequestedFinalState}
                        onInspectImportJson={inspectImportJson}
                        onInspectRequestedFinalState={inspectRequestedFinalState}
                        onLoadActions={(run) => void loadRunActions(run)}
                        onLoadLive={() => void loadLiveExplorerSnapshot()}
                        onOverlayModeChange={setExplorerOverlayMode}
                        onSelectedEntityKeyChange={setSelectedExplorerEntityKey}
                    />
                    <BackupHistory
                        page={backupPage}
                        busyAction={busyAction}
                        onDownload={(backup) => void loadBackupJson(backup, 'download')}
                        onCheckDrift={(backup) => void checkDrift(backup)}
                        onInspect={(backup) => void loadBackupJson(backup, 'inspect')}
                        onImport={(backup) => void importBackup(backup)}
                        onLoadMore={() => void loadMoreBackups()}
                        onRename={(backup) => void renameBackup(backup)}
                        onDelete={(backup) => void deleteBackup(backup)}
                        editingBackupId={editingBackupId}
                        editingBackupName={editingBackupName}
                        deleteConfirmBackupId={deleteConfirmBackupId}
                        onBeginRename={(backup) => {
                            setEditingBackupId(backup.id);
                            setEditingBackupName(backup.name);
                            setDeleteConfirmBackupId(undefined);
                        }}
                        onCancelRename={() => {
                            setEditingBackupId(undefined);
                            setEditingBackupName('');
                        }}
                        onRenameNameChange={setEditingBackupName}
                        onCancelDelete={() => setDeleteConfirmBackupId(undefined)}
                    />
                    <DashboardStructureImportHistory
                        runs={importRuns}
                        latestRun={latestRun}
                        busyAction={busyAction}
                        confirmationByRunId={confirmationByRunId}
                        preflightByRunId={preflightByRunId}
                        applyConfirmationByRunId={applyConfirmationByRunId}
                        deleteConfirmationByRunId={deleteConfirmationByRunId}
                        onConfirmationChange={(runId, confirmation) =>
                            setConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onApplyConfirmationChange={(runId, confirmation) =>
                            setApplyConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onDeleteConfirmationChange={(runId, confirmation) =>
                            setDeleteConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onConfirm={(run) => void confirmImportRun(run)}
                        onPreflight={(run) => void preflightImportRun(run)}
                        onApply={(run) => void applyImportRun(run)}
                        onLoadActions={(run) => void loadRunActions(run)}
                        onInspectAction={selectImportAction}
                        onRetry={(run) => void retryImportRun(run)}
                    />
                </section>
            </div>
        </article>
    );
}

function BackupSettings({
    settings,
    enabled,
    cadenceWeeks,
    retentionDays,
    busy,
    onEnabledChange,
    onCadenceWeeksChange,
    onRetentionDaysChange,
    onSave,
}: {
    settings: DashboardStructureBackupSettings;
    enabled: boolean;
    cadenceWeeks: number;
    retentionDays: number;
    busy: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onCadenceWeeksChange: (weeks: number) => void;
    onRetentionDaysChange: (days: number) => void;
    onSave: () => void;
}) {
    return (
        <div
            id='server-blueprint-backup-settings'
            className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Automatic backups</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Opt-in scheduled backups. Minimum cadence is 1 week.
                    </p>
                </div>
                <label className='flex items-center gap-2 text-sm font-medium text-neutral-200'>
                    <input
                        type='checkbox'
                        checked={enabled}
                        onChange={(event) => onEnabledChange(event.currentTarget.checked)}
                        className='size-4 rounded border-neutral-600 bg-neutral-950'
                    />
                    Enabled
                </label>
            </div>
            <div className='mt-3 flex flex-wrap items-end gap-3'>
                <label className='block text-xs font-semibold text-neutral-300'>
                    Cadence
                    <span className='mt-1 flex items-center gap-2'>
                        <input
                            type='number'
                            min={1}
                            step={1}
                            value={cadenceWeeks}
                            onChange={(event) =>
                                onCadenceWeeksChange(Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                            }
                            className='h-10 w-20 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        />
                        <span className='text-sm text-neutral-400'>week{cadenceWeeks === 1 ? '' : 's'}</span>
                    </span>
                </label>
                <label className='block text-xs font-semibold text-neutral-300'>
                    Retention
                    <span className='mt-1 flex items-center gap-2'>
                        <input
                            type='number'
                            min={1}
                            max={180}
                            step={1}
                            value={retentionDays}
                            onChange={(event) =>
                                onRetentionDaysChange(
                                    Math.min(180, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                                )
                            }
                            className='h-10 w-20 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        />
                        <span className='text-sm text-neutral-400'>days</span>
                    </span>
                </label>
                <button
                    type='button'
                    onClick={onSave}
                    disabled={busy}
                    className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    {busy ? 'Saving' : 'Save'}
                </button>
            </div>
            <p className='mt-3 text-xs leading-5 text-neutral-500'>
                {settings.nextBackupAt
                    ? `Next scheduled backup: ${formatDate(settings.nextBackupAt)}.`
                    : 'No scheduled backup is queued.'}{' '}
                Backups are automatically removed after {retentionDays} day{retentionDays === 1 ? '' : 's'}.
            </p>
        </div>
    );
}

function BackupStatus({
    backups,
    observedState,
    settings,
}: {
    backups: DashboardStructureBackupSummary[];
    observedState: { changedSinceLastBackup: boolean };
    settings: DashboardStructureBackupSettings;
}) {
    const latestBackup = backups.at(0);
    const latestSuccessfulBackup = backups.find((backup) => backup.status === 'succeeded');
    const healthIssues = deriveDashboardStructureBackupHealth({
        backups,
        formatDate,
        settings,
    });
    const backupState = settings.lastErrorMessage
        ? settings.lastErrorMessage
        : latestBackup?.status === 'failed'
          ? (latestBackup.errorMessage ?? 'Latest backup failed')
          : observedState.changedSinceLastBackup
            ? 'Server layout changed since backup'
            : latestSuccessfulBackup
              ? 'Current backup available'
              : 'No backup yet';
    const backupTone =
        settings.lastErrorMessage || latestBackup?.status === 'failed'
            ? 'error'
            : observedState.changedSinceLastBackup || !latestSuccessfulBackup
              ? 'neutral'
              : 'success';

    return (
        <div className='space-y-3'>
            <div className='grid gap-3 md:grid-cols-3'>
                <StatusTile
                    label='Last attempt'
                    value={settings.lastAttemptAt ? formatDate(settings.lastAttemptAt) : 'Never'}
                />
                <StatusTile
                    label='Last success'
                    value={settings.lastSuccessAt ? formatDate(settings.lastSuccessAt) : 'Never'}
                />
                <StatusTile label='Backup state' value={backupState} tone={backupTone} />
            </div>
            {healthIssues.length > 0 ? (
                <div
                    aria-label='Backup health'
                    className='space-y-2 rounded-md border border-amber-400/20 bg-amber-400/5 p-3'>
                    {healthIssues.map((issue) => (
                        <div
                            key={issue.type}
                            className={`flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2 ${
                                issue.tone === 'error'
                                    ? 'border-rose-400/25 bg-rose-400/10'
                                    : 'border-amber-400/25 bg-amber-400/10'
                            }`}>
                            <div className='min-w-0'>
                                <p
                                    className={`text-sm font-semibold ${
                                        issue.tone === 'error' ? 'text-rose-100' : 'text-amber-100'
                                    }`}>
                                    {issue.title}
                                </p>
                                <p className='mt-1 text-xs leading-5 text-neutral-300'>{issue.detail}</p>
                            </div>
                            <a
                                href={issue.href}
                                className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                Review
                            </a>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function DriftPanel({
    drift,
    settings,
    busyAction,
    onCheckLatest,
    onCreateBackup,
    onCreateDryRun,
    onReviewScheduledDrift,
    onSelectAction,
}: {
    drift: DriftState | undefined;
    settings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    onCheckLatest: () => void;
    onCreateBackup: () => void;
    onCreateDryRun: (backup: DashboardStructureBackupSummary) => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
    onSelectAction: (action: DriftState['previewActions'][number]) => void;
}) {
    const driftCount = drift ? countPlanChanges(drift.summary) : 0;
    const isChecking = busyAction === 'drift';
    const busy = Boolean(busyAction);
    const scheduledDrift = settings.scheduledDrift;

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Drift check</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Manual live comparison against the latest regular backup or a selected backup row.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={onCheckLatest}
                    disabled={busy}
                    className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    {isChecking ? 'Checking' : 'Check latest'}
                </button>
            </div>

            {scheduledDrift ? (
                <ScheduledDriftStatus
                    busy={busy}
                    isReviewing={isChecking}
                    scheduledDrift={scheduledDrift}
                    onReviewScheduledDrift={onReviewScheduledDrift}
                />
            ) : settings.enabled ? (
                <p className='mt-3 rounded-md border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs leading-5 text-neutral-500'>
                    Scheduled drift monitoring is queued with automatic backups.
                    {settings.nextDriftCheckAt ? ` Next check: ${formatDate(settings.nextDriftCheckAt)}.` : ''}
                </p>
            ) : null}

            {drift ? (
                <div className='mt-4 space-y-4'>
                    <div className='flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-3'>
                        <div>
                            <p className='text-sm font-semibold text-white'>
                                {driftCount === 0
                                    ? `Live server matches ${drift.baseline.name}.`
                                    : `${driftCount} drift changes found`}
                            </p>
                            <p className='mt-1 text-xs leading-5 text-neutral-500'>
                                Baseline: {drift.baseline.name} · {formatBackupSource(drift.baseline.source)} ·{' '}
                                {formatDate(drift.baseline.completedAt)}
                            </p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                onClick={onCreateBackup}
                                disabled={busy}
                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                Create backup now
                            </button>
                            <button
                                type='button'
                                onClick={() => onCreateDryRun(drift.baseline)}
                                disabled={busy || drift.baseline.status !== 'succeeded'}
                                className='min-h-9 rounded-md bg-sky-400 px-3 text-xs font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                Create dry-run from baseline
                            </button>
                        </div>
                    </div>

                    <div className='grid grid-cols-3 gap-2 text-center md:grid-cols-6'>
                        <MiniCount label='Creates' value={drift.summary.creates} />
                        <MiniCount label='Updates' value={drift.summary.updates} />
                        <MiniCount label='Deletes' value={drift.summary.deletes} />
                        <MiniCount label='Roles' value={drift.summary.roles} />
                        <MiniCount label='Categories' value={drift.summary.categories} />
                        <MiniCount label='Channels' value={drift.summary.channels} />
                    </div>

                    <div className='grid grid-cols-2 gap-2 text-center md:grid-cols-3'>
                        <MiniCount label='Names' value={drift.fieldSummary.names} />
                        <MiniCount label='Permissions' value={drift.fieldSummary.permissions} />
                        <MiniCount label='Positions' value={drift.fieldSummary.positions} />
                        <MiniCount label='Parents' value={drift.fieldSummary.parentMoves} />
                        <MiniCount label='Types' value={drift.fieldSummary.typeChanges} />
                        <MiniCount label='Role visuals' value={drift.fieldSummary.roleVisuals} />
                    </div>

                    {drift.previewActions.length > 0 ? (
                        <div className='max-h-56 overflow-y-auto rounded-md border border-neutral-800'>
                            {drift.previewActions.map((action) => (
                                <button
                                    type='button'
                                    key={action.id}
                                    onClick={() => onSelectAction(action)}
                                    className='grid gap-2 border-b border-neutral-800 px-3 py-2 text-left last:border-b-0 md:grid-cols-[5rem_7rem_minmax(0,1fr)_minmax(8rem,0.7fr)]'>
                                    <span className='text-xs font-semibold text-neutral-300'>
                                        {formatStatus(action.actionType)}
                                    </span>
                                    <span className='text-xs text-neutral-500'>{formatStatus(action.targetType)}</span>
                                    <span className='truncate text-xs text-neutral-200'>
                                        {action.label ?? action.targetId ?? 'Unknown target'}
                                    </span>
                                    <span className='truncate text-xs text-neutral-500'>
                                        {action.fields.length > 0 ? action.fields.map(formatStatus).join(', ') : 'item'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {drift.hasMorePreview ? (
                        <p className='text-xs leading-5 text-neutral-500'>
                            Preview is capped. Create a dry-run from the baseline to review every action.
                        </p>
                    ) : null}
                    <p className='text-xs leading-5 text-neutral-500'>
                        Checked {formatDate(drift.checkedAt)}. Live counts: {drift.liveCounts.roles} roles,{' '}
                        {drift.liveCounts.categories} categories, {drift.liveCounts.channels} channels.
                    </p>
                </div>
            ) : (
                <p className='mt-3 border-t border-neutral-800 pt-3 text-xs leading-5 text-neutral-500'>
                    No drift check has been run in this view.
                </p>
            )}
        </div>
    );
}

function ScheduledDriftStatus({
    busy,
    isReviewing,
    scheduledDrift,
    onReviewScheduledDrift,
}: {
    busy: boolean;
    isReviewing: boolean;
    scheduledDrift: NonNullable<DashboardStructureBackupSettings['scheduledDrift']>;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
}) {
    const status = readScheduledDriftCopy(scheduledDrift);
    const canReview = scheduledDrift.status === 'changed' && Boolean(scheduledDrift.baselineBackupId);

    return (
        <div
            className={`mt-3 rounded-md border px-3 py-2 ${
                status.tone === 'error'
                    ? 'border-rose-400/25 bg-rose-400/10'
                    : status.tone === 'warning'
                      ? 'border-amber-400/25 bg-amber-400/10'
                      : 'border-neutral-800 bg-neutral-950/70'
            }`}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p
                        className={`text-sm font-semibold ${
                            status.tone === 'error'
                                ? 'text-rose-100'
                                : status.tone === 'warning'
                                  ? 'text-amber-100'
                                  : 'text-neutral-100'
                        }`}>
                        {status.title}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>{status.detail}</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-500'>
                        {scheduledDrift.checkedAt
                            ? `Checked ${formatDate(scheduledDrift.checkedAt)}.`
                            : 'Not checked yet.'}
                        {scheduledDrift.nextCheckAt ? ` Next: ${formatDate(scheduledDrift.nextCheckAt)}.` : ''}
                    </p>
                </div>
                {canReview ? (
                    <button
                        type='button'
                        onClick={() => onReviewScheduledDrift(scheduledDrift.baselineBackupId ?? '')}
                        disabled={busy}
                        className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {isReviewing ? 'Reviewing' : 'Review drift'}
                    </button>
                ) : null}
            </div>
            {scheduledDrift.summary ? (
                <div className='mt-3 grid grid-cols-3 gap-2 text-center md:grid-cols-6'>
                    <MiniCount label='Creates' value={scheduledDrift.summary.creates} />
                    <MiniCount label='Updates' value={scheduledDrift.summary.updates} />
                    <MiniCount label='Deletes' value={scheduledDrift.summary.deletes} />
                    <MiniCount label='Roles' value={scheduledDrift.summary.roles} />
                    <MiniCount label='Categories' value={scheduledDrift.summary.categories} />
                    <MiniCount label='Channels' value={scheduledDrift.summary.channels} />
                </div>
            ) : null}
        </div>
    );
}

function readScheduledDriftCopy(scheduledDrift: NonNullable<DashboardStructureBackupSettings['scheduledDrift']>): {
    detail: string;
    title: string;
    tone: 'error' | 'neutral' | 'warning';
} {
    if (scheduledDrift.status === 'changed') {
        const count = scheduledDrift.changeCount ?? countPlanChanges(scheduledDrift.summary ?? emptyPlanSummary);

        return {
            detail: `Baseline: ${scheduledDrift.baselineName ?? scheduledDrift.baselineBackupId ?? 'latest backup'}.`,
            title: `Scheduled drift found ${count} change${count === 1 ? '' : 's'}.`,
            tone: 'warning',
        };
    }

    if (scheduledDrift.status === 'failed') {
        return {
            detail: scheduledDrift.errorMessage ?? 'The scheduled drift check failed.',
            title: 'Scheduled drift check failed.',
            tone: 'error',
        };
    }

    if (scheduledDrift.status === 'no_baseline') {
        return {
            detail: 'Create or wait for a successful regular backup before scheduled drift can compare layouts.',
            title: 'Scheduled drift needs a baseline.',
            tone: 'warning',
        };
    }

    if (scheduledDrift.status === 'clean') {
        return {
            detail: scheduledDrift.baselineName
                ? `Live server matched ${scheduledDrift.baselineName}.`
                : 'Live server matched the latest regular backup.',
            title: 'No scheduled drift found.',
            tone: 'neutral',
        };
    }

    return {
        detail: 'Scheduled drift monitoring is queued with automatic backups.',
        title: 'Scheduled drift pending.',
        tone: 'neutral',
    };
}

function StatusTile({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    tone?: 'success' | 'error' | 'neutral';
}) {
    const valueClass =
        tone === 'error' ? 'text-rose-200' : tone === 'success' ? 'text-emerald-200' : 'text-neutral-200';

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <p className='text-xs font-medium text-neutral-500 uppercase'>{label}</p>
            <p className={`mt-2 text-sm leading-5 ${valueClass}`}>{value}</p>
        </div>
    );
}

function BackupHistory({
    page,
    busyAction,
    onDownload,
    onCheckDrift,
    onInspect,
    onImport,
    onLoadMore,
    onRename,
    onDelete,
    editingBackupId,
    editingBackupName,
    deleteConfirmBackupId,
    onBeginRename,
    onCancelRename,
    onRenameNameChange,
    onCancelDelete,
}: {
    page: BackupPageState;
    busyAction: StructureBusyAction | undefined;
    onDownload: (backup: DashboardStructureBackupSummary) => void;
    onCheckDrift: (backup: DashboardStructureBackupSummary) => void;
    onInspect: (backup: DashboardStructureBackupSummary) => void;
    onImport: (backup: DashboardStructureBackupSummary) => void;
    onLoadMore: () => void;
    onRename: (backup: DashboardStructureBackupSummary) => void;
    onDelete: (backup: DashboardStructureBackupSummary) => void;
    editingBackupId: string | undefined;
    editingBackupName: string;
    deleteConfirmBackupId: string | undefined;
    onBeginRename: (backup: DashboardStructureBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onCancelDelete: () => void;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const backups = page.backups;
    const hasLoadMoreRow = Boolean(page.nextCursor);
    const rowCount = backups.length + (hasLoadMoreRow ? 1 : 0);
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 118,
        initialRect: { height: 448, width: 800 },
        overscan: 5,
    });
    const virtualRows = virtualizer.getVirtualItems();
    const renderedRows =
        virtualRows.length > 0
            ? virtualRows
            : Array.from({ length: rowCount }, (_, index) => ({
                  index,
                  key: `backup-fallback-${index}`,
                  start: index * 118,
              }));
    const headerText = useMemo(
        () =>
            backups.length === 1
                ? '1 stored backup'
                : backups.length > 1
                  ? `${backups.length} stored backups`
                  : 'No stored backups',
        [backups.length]
    );

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2'>
                <div>
                    <p className='text-sm font-semibold text-white'>Backup library</p>
                    <p className='mt-0.5 text-xs text-neutral-500'>{headerText}</p>
                </div>
                {page.nextCursor ? (
                    <button
                        type='button'
                        onClick={onLoadMore}
                        disabled={Boolean(busyAction)}
                        className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {busyAction === 'backup-page' ? 'Loading' : 'Load more'}
                    </button>
                ) : null}
            </div>
            {backups.length === 0 ? (
                <p className='px-3 py-8 text-sm leading-6 text-neutral-400'>No server blueprint backups yet.</p>
            ) : (
                <div ref={parentRef} className='h-[28rem] overflow-y-auto overscroll-contain'>
                    <div
                        className='relative w-full'
                        style={{
                            height: `${Math.max(virtualizer.getTotalSize(), rowCount * 118)}px`,
                        }}>
                        {renderedRows.map((virtualRow) => {
                            const backup = backups[virtualRow.index] as DashboardStructureBackupSummary | undefined;

                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    className='absolute top-0 left-0 w-full px-3 py-2'
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}>
                                    {backup ? (
                                        <BackupLibraryRow
                                            backup={backup}
                                            busyAction={busyAction}
                                            isEditing={editingBackupId === backup.id}
                                            editingName={editingBackupName}
                                            isDeleteConfirming={deleteConfirmBackupId === backup.id}
                                            onBeginRename={onBeginRename}
                                            onCancelRename={onCancelRename}
                                            onRenameNameChange={onRenameNameChange}
                                            onRename={onRename}
                                            onCheckDrift={onCheckDrift}
                                            onInspect={onInspect}
                                            onImport={onImport}
                                            onDownload={onDownload}
                                            onDelete={onDelete}
                                            onCancelDelete={onCancelDelete}
                                        />
                                    ) : (
                                        <button
                                            type='button'
                                            onClick={onLoadMore}
                                            disabled={Boolean(busyAction)}
                                            className='min-h-14 w-full rounded-md border border-dashed border-neutral-700 text-sm font-semibold text-neutral-300 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                            {busyAction === 'backup-page' ? 'Loading backups' : 'Load more backups'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function BackupLibraryRow({
    backup,
    busyAction,
    isEditing,
    editingName,
    isDeleteConfirming,
    onBeginRename,
    onCancelRename,
    onRenameNameChange,
    onRename,
    onCheckDrift,
    onInspect,
    onImport,
    onDownload,
    onDelete,
    onCancelDelete,
}: {
    backup: DashboardStructureBackupSummary;
    busyAction: StructureBusyAction | undefined;
    isEditing: boolean;
    editingName: string;
    isDeleteConfirming: boolean;
    onBeginRename: (backup: DashboardStructureBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onRename: (backup: DashboardStructureBackupSummary) => void;
    onCheckDrift: (backup: DashboardStructureBackupSummary) => void;
    onInspect: (backup: DashboardStructureBackupSummary) => void;
    onImport: (backup: DashboardStructureBackupSummary) => void;
    onDownload: (backup: DashboardStructureBackupSummary) => void;
    onDelete: (backup: DashboardStructureBackupSummary) => void;
    onCancelDelete: () => void;
}) {
    const isSucceeded = backup.status === 'succeeded';
    const backupRowId = buildDashboardStructureBackupRowId(backup.id);
    const busy = Boolean(busyAction);
    const isDriftBusy = busyAction === `backup-drift:${backup.id}`;
    const isInspectBusy = busyAction === `backup-json:${backup.id}`;
    const isRenameBusy = busyAction === `backup-rename:${backup.id}`;
    const isImportBusy = busyAction === `backup-import:${backup.id}`;
    const isDownloadBusy = busyAction === `backup-json:${backup.id}`;
    const isDeleteBusy = busyAction === `backup-delete:${backup.id}`;
    const isRestorePoint = backup.source === 'restore_point';

    return (
        <div
            id={backupRowId}
            role='group'
            aria-label={`Backup ${backup.name}`}
            className='scroll-mt-24 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3 shadow-sm'>
            <div className='grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.75fr)_auto] lg:items-center'>
                <div className='min-w-0'>
                    {isEditing ? (
                        <div className='flex min-w-0 gap-2'>
                            <input
                                value={editingName}
                                onChange={(event) => onRenameNameChange(event.currentTarget.value)}
                                maxLength={120}
                                className='h-9 min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                                aria-label='Backup name'
                            />
                            <IconButton
                                label='Save backup name'
                                disabled={busy}
                                onClick={() => onRename(backup)}
                                busy={isRenameBusy}>
                                <Check className='size-4' />
                            </IconButton>
                            <IconButton label='Cancel rename' disabled={busy} onClick={onCancelRename}>
                                <X className='size-4' />
                            </IconButton>
                        </div>
                    ) : (
                        <button
                            type='button'
                            onClick={() => onBeginRename(backup)}
                            className='group flex min-w-0 items-center gap-2 text-left'>
                            <span className='truncate text-sm font-semibold text-white group-hover:text-sky-200'>
                                {backup.name}
                            </span>
                            <Pencil className='size-3.5 shrink-0 text-neutral-500 group-hover:text-sky-300' />
                        </button>
                    )}
                    <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500'>
                        <span>{formatDate(backup.completedAt)}</span>
                        <span>{formatBackupSource(backup.source)}</span>
                        <span className={backup.status === 'failed' ? 'text-rose-300' : 'text-emerald-300'}>
                            {backup.status === 'failed' ? (backup.errorMessage ?? 'Failed') : 'Succeeded'}
                        </span>
                    </div>
                </div>
                <div className='grid grid-cols-3 gap-2 text-center'>
                    <MiniCount label='Roles' value={backup.roleCount} />
                    <MiniCount label='Categories' value={backup.categoryCount} />
                    <MiniCount label='Channels' value={backup.channelCount} />
                </div>
                <div className='flex justify-start gap-2 lg:justify-end'>
                    <IconButton
                        label='Check drift against this backup'
                        disabled={busy || !isSucceeded}
                        busy={isDriftBusy}
                        onClick={() => onCheckDrift(backup)}>
                        <GitCompareArrows className='size-4' />
                    </IconButton>
                    <IconButton
                        label='Inspect backup'
                        disabled={busy || !isSucceeded}
                        busy={isInspectBusy}
                        onClick={() => onInspect(backup)}>
                        <Eye className='size-4' />
                    </IconButton>
                    <IconButton
                        label={isRestorePoint ? 'Create restore dry-run' : 'Create dry-run from backup'}
                        disabled={busy || !isSucceeded}
                        busy={isImportBusy}
                        onClick={() => onImport(backup)}>
                        {isRestorePoint ? <RotateCcw className='size-4' /> : <Upload className='size-4' />}
                    </IconButton>
                    <IconButton
                        label='Download backup JSON'
                        disabled={busy || !isSucceeded}
                        busy={isDownloadBusy}
                        onClick={() => onDownload(backup)}>
                        <Download className='size-4' />
                    </IconButton>
                    {isDeleteConfirming ? (
                        <>
                            <IconButton
                                label='Confirm backup delete'
                                disabled={busy}
                                busy={isDeleteBusy}
                                tone='danger'
                                onClick={() => onDelete(backup)}>
                                <Trash2 className='size-4' />
                            </IconButton>
                            <IconButton label='Cancel delete' disabled={busy} onClick={onCancelDelete}>
                                <RotateCcw className='size-4' />
                            </IconButton>
                        </>
                    ) : (
                        <IconButton
                            label='Delete backup'
                            disabled={busy}
                            tone='danger'
                            onClick={() => onDelete(backup)}>
                            <Trash2 className='size-4' />
                        </IconButton>
                    )}
                </div>
            </div>
        </div>
    );
}

function MiniCount({ label, value }: { label: string; value: number }) {
    return (
        <div className='rounded border border-neutral-800 bg-neutral-900/70 px-2 py-1.5'>
            <p className='text-xs font-semibold text-neutral-200'>{value}</p>
            <p className='mt-0.5 text-[0.68rem] text-neutral-500 uppercase'>{label}</p>
        </div>
    );
}

function IconButton({
    label,
    disabled,
    busy,
    tone = 'neutral',
    onClick,
    children,
}: {
    label: string;
    disabled?: boolean;
    busy?: boolean;
    tone?: 'neutral' | 'danger';
    onClick: () => void;
    children: ReactNode;
}) {
    const toneClass =
        tone === 'danger'
            ? 'border-neutral-700 text-rose-200 hover:border-rose-400 hover:text-rose-100'
            : 'border-neutral-700 text-neutral-100 hover:border-sky-400 hover:text-sky-200';

    return (
        <button
            type='button'
            aria-label={label}
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={`grid size-9 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600 ${toneClass}`}>
            {busy ? <span className='size-3 animate-pulse rounded-full bg-current' /> : children}
        </button>
    );
}

function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass =
        status.tone === 'success' ? 'text-emerald-300' : status.tone === 'error' ? 'text-rose-300' : 'text-neutral-400';

    return (
        <p
            className={`text-sm leading-6 ${colorClass}`}
            role={status.tone === 'error' ? 'alert' : 'status'}
            aria-live={status.tone === 'error' ? 'assertive' : 'polite'}>
            {status.message}
        </p>
    );
}

function RestorePointShortcutNotice({
    backupId,
    busy,
    disabled,
    onCreateRestoreDryRun,
}: {
    backupId: string;
    busy: boolean;
    disabled: boolean;
    onCreateRestoreDryRun: (backupId: string) => void;
}) {
    return (
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm'>
            <p className='text-amber-100'>Restore point saved before apply.</p>
            <button
                type='button'
                onClick={() => onCreateRestoreDryRun(backupId)}
                disabled={disabled}
                className='inline-flex min-h-8 items-center gap-2 rounded-md border border-amber-300/50 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-200 hover:text-white disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-500'>
                <RotateCcw className='size-3.5' />
                {busy ? 'Creating restore dry-run' : 'Create restore dry-run'}
            </button>
        </div>
    );
}

function downloadJsonFile(fileName: string, content: string): void {
    if (typeof document === 'undefined') return;

    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');

    try {
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
    }
}

function DashboardStructureLoading() {
    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-label='Loading server blueprint tools'>
            <div className='h-5 w-44 animate-pulse rounded bg-neutral-800' />
            <div className='mt-3 h-4 w-64 animate-pulse rounded bg-neutral-800' />
            <div className='mt-5 h-32 animate-pulse rounded bg-neutral-950' />
        </article>
    );
}

function toRunActionStatus(result: {
    type: string;
    message?: string;
    expectedText?: string;
    status?: string;
}): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'confirmation-mismatch' && result.expectedText) {
        return { tone: 'error', message: `Type ${result.expectedText} exactly to confirm.` };
    }
    if (result.type === 'not-confirmable' && result.status) {
        return { tone: 'error', message: `This dry-run is ${formatStatus(result.status)} and cannot be confirmed.` };
    }
    return toErrorStatus(result.type);
}

function toApplyErrorStatus(result: {
    type: string;
    message?: string;
    expectedText?: string;
    status?: string;
    report?: DashboardStructurePreflightReport;
}): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'confirmation-mismatch' && result.expectedText) {
        return { tone: 'error', message: `Type ${result.expectedText} exactly to apply.` };
    }
    if (result.type === 'destructive-confirmation-mismatch' && result.expectedText) {
        return { tone: 'error', message: `Type ${result.expectedText} exactly to approve deletes.` };
    }
    if (result.type === 'not-applicable' && result.status) {
        return { tone: 'error', message: `This dry-run is ${formatStatus(result.status)} and cannot be applied.` };
    }
    if (result.type === 'preflight-blocked' && result.report) {
        return {
            tone: 'error',
            message: `Apply blocked: ${result.report.summary.ready}/${result.report.summary.total} actions are ready.`,
        };
    }
    return toErrorStatus(result.type);
}

function toDriftErrorStatus(type: string): PanelStatus {
    if (type === 'no-baseline') {
        return { tone: 'error', message: 'Create a successful server blueprint backup before checking drift.' };
    }
    if (type === 'backup-json-unavailable') {
        return { tone: 'error', message: 'This backup does not have usable server blueprint JSON.' };
    }
    return toErrorStatus(type);
}

function toErrorStatus(type: string): PanelStatus {
    const messages: Record<string, string> = {
        'auth-required': 'Sign in again before changing server blueprint data.',
        'bot-token-missing': 'The web service needs FLUXER_BOT_TOKEN to read server layout.',
        'restore-point-failed': 'Apply was not started because NeonFlux could not save a restore point.',
        'structure-read-failed': 'NeonFlux could not read this server layout.',
        'database-error': 'The dashboard database could not save the server blueprint data.',
        'guild-lookup-failed': 'This server could not be loaded from Fluxer.',
        'deployment-config-not-found': 'Dashboard deployment config is missing.',
        'not-found': 'This server is not available for this account.',
    };

    return {
        tone: 'error',
        message: messages[type] ?? 'Server blueprint operation failed.',
    };
}

function countPlanChanges(summary: { creates: number; deletes: number; updates: number }): number {
    return summary.creates + summary.updates + summary.deletes;
}

function readRequestedFinalStateExplorerSnapshot(
    run: DashboardStructureImportRun
): DashboardStructureExplorerSource['snapshot'] {
    return run.requestedSnapshot
        ? parseDashboardStructureExplorerSnapshot(JSON.stringify(run.requestedSnapshot))
        : undefined;
}

function formatCounts(value: Pick<DashboardStructureBackupSummary, 'roleCount' | 'categoryCount' | 'channelCount'>) {
    return `${value.roleCount} roles, ${value.categoryCount} categories, ${value.channelCount} channels`;
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function formatStatus(status: string): string {
    return status.replaceAll('_', ' ');
}

function formatBackupSource(source: string): string {
    const labels: Record<string, string> = {
        manual: 'Manual',
        restore_point: 'Restore point',
        scheduled: 'Scheduled',
    };

    return labels[source] ?? formatStatus(source);
}

function formatObservedState(state: {
    observedChangeCount: number;
    lastEventType?: string;
    lastObservedAt?: string;
    changedSinceLastBackup: boolean;
}) {
    const event = state.lastEventType ? formatStatus(state.lastEventType) : 'server layout change';
    const date = state.lastObservedAt ? formatDate(state.lastObservedAt) : undefined;
    const backupNote = state.changedSinceLastBackup ? ' Backup recommended.' : '';

    return `${state.observedChangeCount} observed server layout change${
        state.observedChangeCount === 1 ? '' : 's'
    }. Last: ${event}${date ? ` at ${date}` : ''}.${backupNote}`;
}
