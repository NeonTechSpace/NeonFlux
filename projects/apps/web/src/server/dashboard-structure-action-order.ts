import { orderFluxerGuildStructureActions } from '@neonflux/fluxer';

import type { DashboardStructurePolicy } from './dashboard-structure-contracts.js';

type StructureActionForOrdering = {
    actionType: string;
    sequence?: number;
    targetType: string;
};

export function orderDashboardStructureImportActions<TAction extends StructureActionForOrdering>(
    actions: readonly TAction[],
    policy: DashboardStructurePolicy
): TAction[] {
    return orderFluxerGuildStructureActions(actions, policy);
}
