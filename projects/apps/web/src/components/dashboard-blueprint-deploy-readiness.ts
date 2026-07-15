import {
    countDashboardBlueprintPreflightHardBlockers,
    isDashboardBlueprintPreflightReady,
} from '../server/dashboard-blueprint-preflight.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';

export type DashboardBlueprintConfirmationDraft = {
    understandsDeletion: boolean;
    understandsRestorePointRequirement: boolean;
    targetGuildName: string;
};

export const emptyDashboardBlueprintConfirmation: DashboardBlueprintConfirmationDraft = {
    understandsDeletion: false,
    understandsRestorePointRequirement: false,
    targetGuildName: '',
};

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
    hardBlockerCount: number;
    nextAction: DashboardBlueprintDeployNextAction;
    preflightExpired: boolean;
    preflightReady: boolean;
    retryPreflightRequired: boolean;
};

export function readDashboardBlueprintDeployReadiness({
    confirmation,
    targetGuildName,
    now = Date.now(),
    preflightReport,
    plan,
}: {
    confirmation: DashboardBlueprintConfirmationDraft;
    targetGuildName: string;
    now?: number;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    plan: DashboardBlueprintPlan;
}): DashboardBlueprintDeployReadiness {
    const destructiveApprovalCount = preflightReport?.summary.destructiveApprovalRequired ?? 0;
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
    const confirmationMatches =
        destructiveApprovalCount === 0 ||
        (plan.policy !== 'merge' &&
            confirmation.understandsDeletion &&
            (plan.policy !== 'rebuild' ||
                (confirmation.understandsRestorePointRequirement &&
                    normalizeTargetName(confirmation.targetGuildName) === normalizeTargetName(targetGuildName))));
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
        hardBlockerCount,
        nextAction,
        preflightExpired,
        preflightReady,
        retryPreflightRequired,
    };
}

function normalizeTargetName(value: string): string {
    return value.normalize('NFC').trim();
}
