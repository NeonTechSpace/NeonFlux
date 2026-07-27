import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardBlueprintBackupsQueryKey } from '../dashboard-query-keys.js';
import { downloadDashboardBlueprintExportRouteData } from '../server/dashboard-blueprint-route-data.js';
import { createDashboardBlueprintBackupCreation } from './dashboard-blueprint-backup-creation.js';
import { useDashboardBlueprintBackupsQuery } from './dashboard-blueprint-backups-query.js';
import { DashboardBlueprintCurrentSurface } from './dashboard-blueprint-current-surface.js';
import { createDashboardBlueprintDriftActions } from './dashboard-blueprint-drift-actions.js';
import { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';
import { parseDashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-snapshot.js';
import type { BlueprintBusyAction, DriftState, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { downloadJsonFile } from './dashboard-blueprint-panel-download.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import { readDashboardBlueprintDiagnosticCode } from './dashboard-blueprint-progress.js';
import { useDashboardBlueprintRuntime } from './dashboard-blueprint-runtime-context.js';
import {
    DashboardBlueprintPendingSurface,
    DashboardBlueprintSurfaceContent,
} from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintCurrentRoute() {
    const runtime = useDashboardBlueprintRuntime();
    const { guildId, navigateToSurface, retryStatus, setComparisonSource, statusError, statusRefreshing } = runtime;
    const queryClient = useQueryClient();
    const backupsQuery = useDashboardBlueprintBackupsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<BlueprintBusyAction | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();

    async function refreshBackups(options: { resetBackups?: boolean } = {}): Promise<void> {
        void options;
        await queryClient.invalidateQueries({ queryKey: getDashboardBlueprintBackupsQueryKey(guildId) });
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    const createBackup = createDashboardBlueprintBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardBlueprintDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

    async function downloadCurrentStructure(): Promise<void> {
        setStatus(undefined);
        setBusyAction('export');

        try {
            const result = await downloadDashboardBlueprintExportRouteData({ data: { guildId } });
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

    async function inspectCurrentLayout(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-live');

        try {
            const result = await downloadDashboardBlueprintExportRouteData({ data: { guildId } });
            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            const snapshot = parseDashboardBlueprintExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setComparisonSource({
                canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
                label: 'Live server layout',
                snapshot,
                type: 'live',
                ...(snapshot.exportedAt ? { detail: `Read ${formatDate(snapshot.exportedAt)}` } : {}),
            });
            await navigateToSurface('compare');
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    if (!backupsQuery.data && backupsQuery.isError) {
        return (
            <DashboardBlueprintPendingSurface
                surface='current'
                error={{
                    diagnosticCode: readDashboardBlueprintDiagnosticCode(backupsQuery.error),
                    retry: () => void backupsQuery.refetch(),
                    retrying: backupsQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data) return <DashboardBlueprintPendingSurface surface='current' />;

    const refreshError = backupsQuery.isError ? backupsQuery.error : statusError;
    return (
        <DashboardBlueprintSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardBlueprintDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardBlueprintCurrentSurface
                workspace={{
                    backupPage: {
                        backups: backupsQuery.data.backups,
                        ...(backupsQuery.data.backupNextCursor
                            ? { nextCursor: backupsQuery.data.backupNextCursor }
                            : {}),
                    },
                    backupSettings: backupsQuery.data.backupSettings,
                    busyAction,
                    driftState,
                    observedState: backupsQuery.data.observedState,
                    onCheckLatestDrift: () => void driftActions.check(),
                    onCreateBackup: () => void createBackup(),
                    onDownloadCurrentStructure: () => void downloadCurrentStructure(),
                    onInspectCurrentLayout: () => void inspectCurrentLayout(),
                }}
            />
        </DashboardBlueprintSurfaceContent>
    );
}
