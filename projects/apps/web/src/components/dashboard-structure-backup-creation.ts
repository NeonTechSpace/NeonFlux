import type { Dispatch, SetStateAction } from 'react';

import { exportDashboardStructureRouteData } from '../server/dashboard-structure-route-data.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatCounts } from './dashboard-structure-panel-format.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';

export function createDashboardStructureBackupCreation({
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
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    return async function createBackup(): Promise<void> {
        setStatus(undefined);
        setBusyAction('backup');

        try {
            const result = await exportDashboardStructureRouteData({ data: { guildId } });

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
