import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';

export type DashboardStructureDeployStage = 1 | 2 | 3;

/**
 * The execution record becomes authoritative as soon as it exists. A queued or
 * running deployment must never be presented as if it were still in review or
 * preflight simply because an older plan status has not refreshed yet.
 */
export function getDashboardStructureDeployStage(
    run: DashboardStructureImportRun | undefined
): DashboardStructureDeployStage {
    if (!run) return 1;
    if (run.execution) return 3;
    if (run.status === 'building' || run.status === 'needs_mapping' || run.status === 'review_ready') return 2;
    if (run.status === 'approved') return 3;
    return 1;
}

export function canStartNewBlueprintDeployment(run: DashboardStructureImportRun | undefined): boolean {
    if (!run?.execution) return true;

    return ['succeeded', 'failed_before_mutation', 'cancelled'].includes(run.execution.status);
}
