import {
    countDashboardBlueprintPreflightHardBlockers,
    isDashboardBlueprintPreflightReady,
} from '../server/dashboard-blueprint-preflight.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { getDashboardBlueprintDeleteApprovalText } from '../server/dashboard-blueprint-contracts.js';
import type { DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';

type DashboardBlueprintDeployNextAction =
    | 'apply'
    | 'approve'
    | 'confirm-delete'
    | 'none'
    | 'preflight'
    | 'review-blocker';

export type DashboardBlueprintDeployReadiness = {
    canApply: boolean;
    destructiveApprovalCount: number;
    expectedDeleteText: string;
    hardBlockerCount: number;
    nextAction: DashboardBlueprintDeployNextAction;
    preflightExpired: boolean;
    preflightReady: boolean;
    retryPreflightRequired: boolean;
};

export function readDashboardBlueprintDeployReadiness({
    deleteConfirmation,
    now = Date.now(),
    preflightReport,
    plan,
}: {
    deleteConfirmation: string;
    now?: number;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    plan: DashboardBlueprintPlan;
}): DashboardBlueprintDeployReadiness {
    const destructiveApprovalCount = preflightReport?.summary.destructiveApprovalRequired ?? 0;
    const expectedDeleteText = getDashboardBlueprintDeleteApprovalText(
        plan.id,
        destructiveApprovalCount,
        plan.deleteSetDigest ?? ''
    );
    const expiresAt = preflightReport?.expiresAt ? new Date(preflightReport.expiresAt).getTime() : undefined;
    const preflightExpired = expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= now);
    const retryPreflightRequired =
        plan.run?.status === 'failed_before_mutation' &&
        (!preflightReport?.checkedAt || preflightReport.checkedAt <= plan.run.updatedAt);
    const hardBlockerCount = preflightReport ? countDashboardBlueprintPreflightHardBlockers(preflightReport) : 0;
    const preflightReady = Boolean(
        preflightReport &&
        isDashboardBlueprintPreflightReady(preflightReport) &&
        !preflightExpired &&
        !retryPreflightRequired
    );
    const confirmationMatches = destructiveApprovalCount === 0 || deleteConfirmation.trim() === expectedDeleteText;
    const canApply = preflightReady && confirmationMatches;
    const hasChanges = plan.planStepCount > 0;

    let nextAction: DashboardBlueprintDeployNextAction = 'none';
    if (!hasChanges || (plan.run && plan.run.status !== 'failed_before_mutation')) {
        nextAction = 'none';
    } else if (plan.planBlockerCount > 0 || hardBlockerCount > 0) {
        nextAction = 'review-blocker';
    } else if (plan.status === 'review_ready') {
        nextAction = 'approve';
    } else if (plan.status === 'approved' && (!preflightReport || preflightExpired || retryPreflightRequired)) {
        nextAction = 'preflight';
    } else if (plan.status === 'approved' && preflightReady && !confirmationMatches) {
        nextAction = 'confirm-delete';
    } else if (plan.status === 'approved' && canApply) {
        nextAction = 'apply';
    }

    return {
        canApply,
        destructiveApprovalCount,
        expectedDeleteText,
        hardBlockerCount,
        nextAction,
        preflightExpired,
        preflightReady,
        retryPreflightRequired,
    };
}
