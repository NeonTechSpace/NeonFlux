import type { Dispatch, SetStateAction } from 'react';

import { readDashboardStructureDriftRouteData } from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureBackupSummary } from '../server/dashboard-structure.server.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { countPlanChanges, toDriftErrorStatus } from './dashboard-structure-panel-status.js';
import type { DriftState, PanelStatus } from './dashboard-structure-panel-types.js';

export function createDashboardStructureDriftActions({
    guildId,
    setBusyAction,
    setDriftState,
    setStatus,
}: {
    guildId: string;
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setDriftState: Dispatch<SetStateAction<DriftState | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    async function run(input: { baselineBackupId?: string; busyAction: StructureBusyAction }): Promise<void> {
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
                          message: `Drift check found ${count} server layout change${count === 1 ? '' : 's'} against ${result.baseline.name}.`,
                      }
            );
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        check: (backup?: DashboardStructureBackupSummary) =>
            run({
                ...(backup ? { baselineBackupId: backup.id } : {}),
                busyAction: backup ? `backup-drift:${backup.id}` : 'drift',
            }),
        reviewScheduled: (baselineBackupId: string) => run({ baselineBackupId, busyAction: 'drift' }),
    };
}
