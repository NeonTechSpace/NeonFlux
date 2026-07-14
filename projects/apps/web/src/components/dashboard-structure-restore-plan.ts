import type { Dispatch, SetStateAction } from 'react';

import { importDashboardStructureBackupRouteData } from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';

export function createDashboardStructureRestorePlan({
    guildId,
    refreshAuditEvents,
    refreshRuns,
    seedRunActions,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedRunActions?: (run: DashboardStructureImportRun) => void;
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    return async function createRestorePlan({
        backupId,
        intent = 'backup',
    }: {
        backupId: string;
        intent?: 'backup' | 'restore';
    }): Promise<DashboardStructureImportRun | undefined> {
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
                return undefined;
            }

            seedRunActions?.(result.importRun);
            setStatus({
                tone: 'success',
                message:
                    intent === 'restore'
                        ? `Restore plan created with ${result.importRun.actionCount} planned changes. Review it before queueing.`
                        : `Deployment plan created from backup with ${result.importRun.actionCount} planned changes.`,
            });
            await refreshRuns();
            await refreshAuditEvents();
            return result.importRun;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    };
}
