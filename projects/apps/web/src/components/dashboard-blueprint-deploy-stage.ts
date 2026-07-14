import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';

export type DashboardBlueprintDeployStage = 1 | 2 | 3;

/**
 * The plan record becomes authoritative as soon as it exists. A queued or
 * running deployment must never be presented as if it were still in review or
 * preflight simply because an older plan status has not refreshed yet.
 */
export function getDashboardBlueprintDeployStage(
    plan: DashboardBlueprintPlan | undefined
): DashboardBlueprintDeployStage {
    if (!plan) return 1;
    if (plan.run) return 3;
    if (plan.status === 'draft' || plan.status === 'needs_input' || plan.status === 'review_ready') return 2;
    if (plan.status === 'approved') return 3;
    return 1;
}

export function canStartNewBlueprintDeployment(plan: DashboardBlueprintPlan | undefined): boolean {
    if (!plan?.run) return true;

    return ['succeeded', 'failed_before_mutation', 'cancelled'].includes(plan.run.status);
}
