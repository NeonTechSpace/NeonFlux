import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintExplorerSource } from './dashboard-blueprint-explorer-types.js';
import { parseDashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-model.js';

export function readRequestedFinalStateExplorerSnapshot(
    plan: DashboardBlueprintPlan
): DashboardBlueprintExplorerSource['snapshot'] {
    return plan.requestedSnapshot
        ? parseDashboardBlueprintExplorerSnapshot(JSON.stringify(plan.requestedSnapshot))
        : undefined;
}
