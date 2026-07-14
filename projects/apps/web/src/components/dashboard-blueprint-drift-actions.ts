import type { Dispatch, SetStateAction } from 'react';

import { readDashboardBlueprintDriftRouteData } from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintBackupSummary } from '../server/dashboard-blueprint-model.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { countPlanChanges, toDriftErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import type { DriftState, PanelStatus } from './dashboard-blueprint-panel-types.js';

export function createDashboardBlueprintDriftActions({
    guildId,
    setBusyAction,
    setDriftState,
    setStatus,
}: {
    guildId: string;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setDriftState?: Dispatch<SetStateAction<DriftState | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    async function run(input: { baselineBackupId?: string; busyAction: BlueprintBusyAction }): Promise<void> {
        setStatus(undefined);
        setBusyAction(input.busyAction);

        try {
            const result = await readDashboardBlueprintDriftRouteData({
                data: {
                    guildId,
                    ...(input.baselineBackupId ? { baselineBackupId: input.baselineBackupId } : {}),
                },
            });

            if (result.type !== 'structure-drift') {
                setDriftState?.(undefined);
                setStatus(toDriftErrorStatus(result.type));
                return;
            }

            setDriftState?.(result);
            const count = countPlanChanges(result.summary);
            setStatus(
                count === 0
                    ? { tone: 'success', message: `Live server matches ${result.baseline.name}.` }
                    : {
                          tone: 'neutral',
                          message: `Drift check found ${count} server layout change${count === 1 ? '' : 's'} against ${result.baseline.name}.`,
                      }
            );
        } catch {
            setDriftState?.(undefined);
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        check: (backup?: DashboardBlueprintBackupSummary) =>
            run({
                ...(backup ? { baselineBackupId: backup.id } : {}),
                busyAction: backup ? `backup-drift:${backup.id}` : 'drift',
            }),
        reviewScheduled: (baselineBackupId: string) => run({ baselineBackupId, busyAction: 'drift' }),
    };
}
