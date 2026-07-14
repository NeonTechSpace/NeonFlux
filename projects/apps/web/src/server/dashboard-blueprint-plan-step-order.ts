import { orderBlueprintPlanSteps } from '@neonflux/blueprint/provider-steps';

import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';

type StructureActionForOrdering = {
    actionType: string;
    sequence?: number;
    targetType: string;
};

export function orderDashboardBlueprintPlanSteps<TAction extends StructureActionForOrdering>(
    actions: readonly TAction[],
    policy: DashboardBlueprintPolicy
): TAction[] {
    return orderBlueprintPlanSteps(actions, policy);
}
