import type { Dispatch, SetStateAction } from 'react';

import { exportDashboardBlueprintRouteData } from '../server/dashboard-blueprint-route-data.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { formatCounts } from './dashboard-blueprint-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';

export function createDashboardBlueprintBackupCreation({
    guildId,
    refreshAuditEvents,
    refreshBackups,
    setBackupJson,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    refreshAuditEvents: () => Promise<void>;
    refreshBackups: (options?: { resetBackups?: boolean }) => Promise<void>;
    setBackupJson?: Dispatch<SetStateAction<string>>;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    return async function createBackup(): Promise<void> {
        setStatus(undefined);
        setBusyAction('backup');

        try {
            const result = await exportDashboardBlueprintRouteData({ data: { guildId } });

            if (result.type !== 'backup-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            setBackupJson?.(result.backupJson);
            setStatus({ tone: 'success', message: `Backup created for ${formatCounts(result.backup)}.` });
            await refreshBackups({ resetBackups: true });
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    };
}
