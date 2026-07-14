import type { Dispatch, SetStateAction } from 'react';

import { importDashboardBlueprintBackupRouteData } from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';

export function createDashboardBlueprintRestorePlan({
    guildId,
    refreshAuditEvents,
    refreshRuns,
    seedPlanSteps,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedPlanSteps?: (plan: DashboardBlueprintPlan) => void;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    return async function createRestorePlan({
        backupId,
        intent = 'backup',
    }: {
        backupId: string;
        intent?: 'backup' | 'restore';
    }): Promise<DashboardBlueprintPlan | undefined> {
        setStatus(undefined);
        setBusyAction(`backup-import:${backupId}`);

        try {
            const result = await importDashboardBlueprintBackupRouteData({ data: { backupId, guildId } });
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

            seedPlanSteps?.(result.plan);
            setStatus({
                tone: 'success',
                message:
                    intent === 'restore'
                        ? `Restore plan created with ${result.plan.changeCount} planned changes. Review it before queueing.`
                        : `Deployment plan created from backup with ${result.plan.changeCount} planned changes.`,
            });
            await refreshRuns();
            await refreshAuditEvents();
            return result.plan;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    };
}
