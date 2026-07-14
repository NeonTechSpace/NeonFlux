import {
    countDashboardStructurePreflightHardBlockers,
    isDashboardStructurePreflightReady,
} from '../server/dashboard-structure-preflight.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import { getDashboardStructureDeleteApprovalText } from '../server/dashboard-structure-contracts.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';

type DashboardStructureDeployNextAction =
    | 'apply'
    | 'approve'
    | 'confirm-delete'
    | 'none'
    | 'preflight'
    | 'review-blocker';

export type DashboardStructureDeployReadiness = {
    canApply: boolean;
    destructiveApprovalCount: number;
    expectedDeleteText: string;
    hardBlockerCount: number;
    nextAction: DashboardStructureDeployNextAction;
    preflightExpired: boolean;
    preflightReady: boolean;
    retryPreflightRequired: boolean;
};

export function readDashboardStructureDeployReadiness({
    deleteConfirmation,
    now = Date.now(),
    preflightReport,
    run,
}: {
    deleteConfirmation: string;
    now?: number;
    preflightReport: DashboardStructurePreflightView | undefined;
    run: DashboardStructureImportRun;
}): DashboardStructureDeployReadiness {
    const destructiveApprovalCount = preflightReport?.summary.destructiveApprovalRequired ?? 0;
    const expectedDeleteText = getDashboardStructureDeleteApprovalText(
        run.id,
        destructiveApprovalCount,
        run.deleteSetDigest ?? ''
    );
    const expiresAt = preflightReport?.expiresAt ? new Date(preflightReport.expiresAt).getTime() : undefined;
    const preflightExpired = expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= now);
    const retryPreflightRequired =
        run.execution?.status === 'failed_before_mutation' &&
        (!preflightReport?.checkedAt || preflightReport.checkedAt <= run.execution.updatedAt);
    const hardBlockerCount = preflightReport ? countDashboardStructurePreflightHardBlockers(preflightReport) : 0;
    const preflightReady = Boolean(
        preflightReport &&
        isDashboardStructurePreflightReady(preflightReport) &&
        !preflightExpired &&
        !retryPreflightRequired
    );
    const confirmationMatches = destructiveApprovalCount === 0 || deleteConfirmation.trim() === expectedDeleteText;
    const canApply = preflightReady && confirmationMatches;
    const hasChanges = run.executionActionCount > 0;

    let nextAction: DashboardStructureDeployNextAction = 'none';
    if (!hasChanges || (run.execution && run.execution.status !== 'failed_before_mutation')) {
        nextAction = 'none';
    } else if (run.planBlockerCount > 0 || hardBlockerCount > 0) {
        nextAction = 'review-blocker';
    } else if (run.status === 'review_ready') {
        nextAction = 'approve';
    } else if (run.status === 'approved' && (!preflightReport || preflightExpired || retryPreflightRequired)) {
        nextAction = 'preflight';
    } else if (run.status === 'approved' && preflightReady && !confirmationMatches) {
        nextAction = 'confirm-delete';
    } else if (run.status === 'approved' && canApply) {
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
