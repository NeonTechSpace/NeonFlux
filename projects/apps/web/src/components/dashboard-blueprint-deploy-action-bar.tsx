import { useEffect, useState } from 'react';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    emptyDashboardBlueprintConfirmation,
    readDashboardBlueprintDeployReadiness,
} from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import type { BlueprintBusyAction, DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import {
    dashboardDangerActionClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

export function DashboardBlueprintDeployActionBar({
    busyAction,
    confirmation = emptyDashboardBlueprintConfirmation,
    onApprove,
    onApply,
    onPreflight,
    onReviewBlocker,
    plan,
    preflightReport,
    reviewAuthorityReady,
    targetGuildName,
}: {
    busyAction: BlueprintBusyAction | undefined;
    confirmation?: DashboardBlueprintConfirmationDraft;
    onApprove: () => void;
    onApply: () => void;
    onPreflight: () => void;
    onReviewBlocker: () => void;
    plan: DashboardBlueprintPlan;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    reviewAuthorityReady: boolean;
    targetGuildName: string;
}) {
    const now = useExpiryClock(preflightReport?.expiresAt);
    const readiness = readDashboardBlueprintDeployReadiness({
        confirmation,
        targetGuildName,
        now,
        preflightReport,
        plan,
    });

    if (readiness.nextAction === 'none') {
        return <p className='text-xs text-[var(--dash-text-muted)]'>No deployment action is currently required.</p>;
    }

    return (
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
                <p className='text-xs font-semibold text-[var(--dash-text)]'>Next safe action</p>
                <p className='mt-0.5 text-xs leading-5 text-[var(--dash-text-muted)]'>
                    {readiness.nextAction === 'confirm-delete'
                        ? 'Complete the confirmation requirements to enable deployment.'
                        : formatNextActionDetail(readiness.nextAction)}
                </p>
            </div>
            <div className='shrink-0'>
                <button
                    type='button'
                    disabled={
                        Boolean(busyAction) ||
                        readiness.nextAction === 'confirm-delete' ||
                        (readiness.nextAction === 'approve' && !reviewAuthorityReady)
                    }
                    onClick={() => {
                        if (readiness.nextAction === 'approve') {
                            if (reviewAuthorityReady) onApprove();
                        } else if (readiness.nextAction === 'preflight') {
                            onPreflight();
                        } else if (readiness.nextAction === 'apply') {
                            onApply();
                        } else {
                            onReviewBlocker();
                        }
                    }}
                    className={`w-full sm:w-auto ${
                        (readiness.nextAction === 'apply' || readiness.nextAction === 'confirm-delete') &&
                        readiness.destructiveApprovalCount > 0
                            ? dashboardDangerActionClassName
                            : readiness.nextAction === 'review-blocker' || readiness.nextAction === 'preflight'
                              ? dashboardSecondaryActionClassName
                              : dashboardPrimaryActionClassName
                    }`}>
                    {formatNextActionLabel(readiness, plan, busyAction)}
                </button>
            </div>
        </div>
    );
}

function formatNextActionDetail(
    action: ReturnType<typeof readDashboardBlueprintDeployReadiness>['nextAction']
): string {
    if (action === 'approve') {
        return 'Records this exact review. NeonFlux will immediately check the live server again; nothing changes yet.';
    }
    if (action === 'preflight') return 'Re-reads the live server; it does not change server state.';
    if (action === 'confirm-delete') return 'Confirm the human-readable impact; the server keeps authority.';
    if (action === 'apply') return 'Starts the durable deployment after saving its restore point.';
    return 'Inspect the blocking change before correcting the source and creating a new plan.';
}

function formatNextActionLabel(
    readiness: ReturnType<typeof readDashboardBlueprintDeployReadiness>,
    plan: DashboardBlueprintPlan,
    busyAction: BlueprintBusyAction | undefined
): string {
    if (readiness.nextAction === 'approve') {
        return busyAction === `approval:${plan.id}` || busyAction === `preflight:${plan.id}`
            ? 'Checking live server'
            : 'Continue to final check';
    }
    if (readiness.nextAction === 'preflight') {
        return busyAction === `preflight:${plan.id}`
            ? 'Checking live server'
            : readiness.preflightExpired || readiness.retryPreflightRequired
              ? 'Refresh safety check'
              : 'Plan safety check';
    }
    if (readiness.nextAction === 'apply') {
        return busyAction === `apply:${plan.id}` ? 'Starting deployment' : 'Deploy blueprint';
    }
    if (readiness.nextAction === 'confirm-delete') return 'Deploy blueprint';
    return 'Review first blocker';
}

function useExpiryClock(expiresAt: string | undefined): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!expiresAt) return;
        const expiryTime = new Date(expiresAt).getTime();
        const delay = Number.isFinite(expiryTime) ? Math.max(0, expiryTime - Date.now()) : 0;
        const timeout = window.setTimeout(() => setNow(Date.now()), delay);
        return () => window.clearTimeout(timeout);
    }, [expiresAt]);

    return now;
}
