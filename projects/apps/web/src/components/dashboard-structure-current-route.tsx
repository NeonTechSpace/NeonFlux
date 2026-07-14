import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardStructureBackupsQueryKey } from '../dashboard-query-keys.js';
import { downloadDashboardStructureExportRouteData } from '../server/dashboard-structure-route-data.js';
import { createDashboardStructureBackupCreation } from './dashboard-structure-backup-creation.js';
import { useDashboardStructureBackupsQuery } from './dashboard-structure-backups-query.js';
import { DashboardStructureCurrentSurface } from './dashboard-structure-current-surface.js';
import { createDashboardStructureDriftActions } from './dashboard-structure-drift-actions.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-json.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { downloadJsonFile } from './dashboard-structure-panel-download.js';
import { formatDate } from './dashboard-structure-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import { readDashboardStructureDiagnosticCode } from './dashboard-structure-progress.js';
import { useDashboardStructureRuntime } from './dashboard-structure-runtime-context.js';
import {
    DashboardStructurePendingSurface,
    DashboardStructureSurfaceContent,
} from './dashboard-structure-surface-state.js';

export function DashboardStructureCurrentRoute() {
    const runtime = useDashboardStructureRuntime();
    const { guildId, navigateToSurface, retryStatus, setComparisonSource, statusError, statusRefreshing } = runtime;
    const queryClient = useQueryClient();
    const backupsQuery = useDashboardStructureBackupsQuery(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [driftState, setDriftState] = useState<DriftState | undefined>();

    async function refreshBackups(options: { resetBackups?: boolean } = {}): Promise<void> {
        void options;
        await queryClient.invalidateQueries({ queryKey: getDashboardStructureBackupsQueryKey(guildId) });
    }

    async function refreshAuditEvents(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
    }

    const createBackup = createDashboardStructureBackupCreation({
        guildId,
        refreshAuditEvents,
        refreshBackups,
        setBusyAction,
        setStatus,
    });
    const driftActions = createDashboardStructureDriftActions({ guildId, setBusyAction, setDriftState, setStatus });

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

    async function inspectCurrentLayout(): Promise<void> {
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

            setComparisonSource({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
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
            <DashboardStructurePendingSurface
                surface='current'
                error={{
                    diagnosticCode: readDashboardStructureDiagnosticCode(backupsQuery.error),
                    retry: () => void backupsQuery.refetch(),
                    retrying: backupsQuery.isFetching,
                }}
            />
        );
    }
    if (!backupsQuery.data) return <DashboardStructurePendingSurface surface='current' />;

    const refreshError = backupsQuery.isError ? backupsQuery.error : statusError;
    return (
        <DashboardStructureSurfaceContent
            status={status}
            refreshIssue={refreshError ? { code: readDashboardStructureDiagnosticCode(refreshError) } : undefined}
            refreshRetrying={backupsQuery.isFetching || statusRefreshing}
            onRetryRefresh={() => {
                if (backupsQuery.isError) void backupsQuery.refetch();
                if (statusError) retryStatus();
            }}>
            <DashboardStructureCurrentSurface
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
        </DashboardStructureSurfaceContent>
    );
}
