import { useState } from 'react';

import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
    createDashboardStructureDryRunRouteData,
    importDashboardStructureBackupRouteData,
    preflightDashboardStructureImportRunRouteData,
    readDashboardStructureImportActionPageRouteData,
    retryDashboardStructureImportRunRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatStatus } from './dashboard-structure-panel-format.js';
import { toApplyErrorStatus, toErrorStatus, toRunActionStatus } from './dashboard-structure-panel-status.js';
import type { ActionPageState, PanelStatus } from './dashboard-structure-panel-types.js';

export function useDashboardStructureImportState({
    guildId,
    importMode,
    importJson,
    refreshAuditEvents,
    refreshSettings,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    importMode: 'merge' | 'replace';
    importJson: string;
    refreshAuditEvents: () => Promise<void>;
    refreshSettings: (options?: { resetBackups?: boolean }) => Promise<void>;
    setBusyAction: (action: StructureBusyAction | undefined) => void;
    setStatus: (status: PanelStatus | undefined) => void;
}) {
    const [actionPagesByRunId, setActionPagesByRunId] = useState<Partial<Record<string, ActionPageState>>>({});
    const [confirmationByRunId, setConfirmationByRunId] = useState<Record<string, string>>({});
    const [applyConfirmationByRunId, setApplyConfirmationByRunId] = useState<Record<string, string>>({});
    const [deleteConfirmationByRunId, setDeleteConfirmationByRunId] = useState<Record<string, string>>({});
    const [preflightByRunId, setPreflightByRunId] = useState<Record<string, DashboardStructurePreflightReport>>({});
    const [restoreShortcutBackupId, setRestoreShortcutBackupId] = useState<string | undefined>();

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
            const result = await importDashboardStructureBackupRouteData({ data: { backupId, guildId } });

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

    async function confirmImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`confirm:${run.id}`);

        try {
            const result = await confirmDashboardStructureImportRunRouteData({
                data: { guildId, importRunId: run.id, confirmationText: confirmationByRunId[run.id] ?? '' },
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
                data: { guildId, importRunId: run.id },
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
            await refreshSettings({ resetBackups: Boolean(result.restorePointBackupId) });
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
                data: { guildId, backupJson: importJson, importMode },
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
                message:
                    importMode === 'replace'
                        ? `Replace dry-run created with ${result.importRun.actionCount} planned changes. Review deletes before applying.`
                        : `Merge dry-run created with ${result.importRun.actionCount} planned changes.`,
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
            const result = await retryDashboardStructureImportRunRouteData({ data: { guildId, importRunId: run.id } });

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

    return {
        actionPagesByRunId,
        applyConfirmationByRunId,
        applyImportRun,
        confirmationByRunId,
        confirmImportRun,
        createDryRun,
        createDryRunFromBackupId,
        deleteConfirmationByRunId,
        loadRunActions,
        preflightByRunId,
        preflightImportRun,
        restoreShortcutBackupId,
        retryImportRun,
        setApplyConfirmationByRunId,
        setConfirmationByRunId,
        setDeleteConfirmationByRunId,
    };
}
