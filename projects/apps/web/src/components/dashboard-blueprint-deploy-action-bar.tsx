import { useEffect, useState } from 'react';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    emptyDashboardBlueprintConfirmation,
    readDashboardBlueprintDeployReadiness,
} from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import type { DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import {
    dashboardDangerActionClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

export function DashboardBlueprintDeployActionBar({
    busyAction,
    confirmation = emptyDashboardBlueprintConfirmation,
    onApprove,
    onApply,
    onConfirmationChange,
    onPreflight,
    onReviewBlocker,
    plan,
    preflightReport,
    targetGuildName,
}: {
    busyAction: BlueprintBusyAction | undefined;
    confirmation?: DashboardBlueprintConfirmationDraft;
    onApprove: () => void;
    onApply: () => void;
    onConfirmationChange: (value: DashboardBlueprintConfirmationDraft) => void;
    onPreflight: () => void;
    onReviewBlocker: () => void;
    plan: DashboardBlueprintPlan;
    preflightReport: DashboardBlueprintPreflightView | undefined;
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
        <div className='rounded-[var(--dash-radius-control)] border border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] p-3'>
            <p className='text-xs font-semibold text-[var(--dash-text)]'>Next safe action</p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                {formatNextActionDetail(readiness.nextAction)}
            </p>
            {readiness.nextAction === 'confirm-delete' ||
            (readiness.nextAction === 'apply' && readiness.destructiveApprovalCount > 0) ? (
                <div className='mt-3 space-y-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/30 bg-[var(--dash-bg)] p-3'>
                    <label className='flex items-start gap-2 text-xs text-[var(--dash-text)]'>
                        <input
                            type='checkbox'
                            checked={confirmation.understandsDeletion}
                            onChange={(event) =>
                                onConfirmationChange({
                                    ...confirmation,
                                    understandsDeletion: event.currentTarget.checked,
                                })
                            }
                        />
                        I understand that {readiness.destructiveApprovalCount} existing object
                        {readiness.destructiveApprovalCount === 1 ? '' : 's'} will be removed.
                    </label>
                    {plan.policy === 'rebuild' ? (
                        <>
                            <label className='flex items-start gap-2 text-xs text-[var(--dash-text)]'>
                                <input
                                    type='checkbox'
                                    checked={confirmation.understandsRestorePointRequirement}
                                    onChange={(event) =>
                                        onConfirmationChange({
                                            ...confirmation,
                                            understandsRestorePointRequirement: event.currentTarget.checked,
                                        })
                                    }
                                />
                                I understand that NeonFlux must create a restore point before mutation.
                            </label>
                            <label className='block text-xs font-semibold text-[var(--dash-text)]'>
                                Type the target server name to continue: {targetGuildName}
                                <input
                                    aria-label='Target server name confirmation'
                                    value={confirmation.targetGuildName}
                                    onChange={(event) =>
                                        onConfirmationChange({
                                            ...confirmation,
                                            targetGuildName: event.currentTarget.value,
                                        })
                                    }
                                    className={`mt-2 ${dashboardFieldClassName} focus:border-[var(--dash-danger)]`}
                                />
                            </label>
                        </>
                    ) : null}
                </div>
            ) : null}
            <div className='mt-3 flex items-end justify-between gap-3 border-t border-[var(--dash-border)] pt-3'>
                <p className='text-xs text-[var(--dash-text-muted)]'>
                    {readiness.nextAction === 'confirm-delete'
                        ? 'Complete the confirmation requirements to enable deployment.'
                        : 'The server revalidates the plan, target, safety check, and delete set.'}
                </p>
                <button
                    type='button'
                    disabled={Boolean(busyAction) || readiness.nextAction === 'confirm-delete'}
                    onClick={
                        readiness.nextAction === 'approve'
                            ? onApprove
                            : readiness.nextAction === 'preflight'
                              ? onPreflight
                              : readiness.nextAction === 'apply'
                                ? onApply
                                : onReviewBlocker
                    }
                    className={
                        (readiness.nextAction === 'apply' || readiness.nextAction === 'confirm-delete') &&
                        readiness.destructiveApprovalCount > 0
                            ? dashboardDangerActionClassName
                            : readiness.nextAction === 'review-blocker' || readiness.nextAction === 'preflight'
                              ? dashboardSecondaryActionClassName
                              : dashboardPrimaryActionClassName
                    }>
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
        return busyAction === `apply:${plan.id}`
            ? 'Starting deployment'
            : `Apply ${plan.changeCount} change${plan.changeCount === 1 ? '' : 's'}${readiness.destructiveApprovalCount ? `, including ${readiness.destructiveApprovalCount} deletion${readiness.destructiveApprovalCount === 1 ? '' : 's'}` : ''}`;
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
