import { motion } from 'motion/react';
import { lazy, Suspense } from 'react';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { formatDashboardBlueprintRunState } from '../server/dashboard-blueprint-contracts.js';
import { DashboardBlueprintRunIssue, formatDashboardBlueprintRunIssue } from './dashboard-blueprint-run-issue.js';
import type { BlueprintBusyAction, DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import { dashboardTactile } from './dashboard-motion.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';

const DashboardBlueprintHistory = lazy(() =>
    import('./dashboard-blueprint-history.js').then((module) => ({ default: module.DashboardBlueprintHistory }))
);

export type DashboardBlueprintRunsWorkspace = {
    busyAction: BlueprintBusyAction | undefined;
    runProgressIssue: { code: string; planId: string } | undefined;
    runProgressRetrying: boolean;
    plans: DashboardBlueprintPlan[];
    latestPlan: DashboardBlueprintPlan | undefined;
    preflightByPlanId: Record<string, DashboardBlueprintPreflightView>;
    onControlRun: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadPlanDecisions: (plan: DashboardBlueprintPlan) => void;
    onPlanEvidenceVisibilityChange: (plan: DashboardBlueprintPlan, visible: boolean) => void;
    onPreflightRun: (plan: DashboardBlueprintPlan) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
    onRetryRunProgress: () => void;
};

export function DashboardBlueprintRunsSurface({ workspace }: { workspace: DashboardBlueprintRunsWorkspace }) {
    return (
        <section aria-labelledby='blueprint-runs-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-runs-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    {surfaceIdentity.runs.heading}
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.runs.description}</p>
            </div>
            {workspace.plans.length === 0 ? (
                <p className='py-10 text-sm text-[var(--dash-text-muted)]'>No deployment plans yet.</p>
            ) : (
                <div role='list' aria-label='Deployment runs'>
                    <div
                        aria-hidden='true'
                        className='hidden grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] gap-4 border-b border-[var(--dash-border)] px-2 py-2 text-xs text-[var(--dash-text-subtle)] md:grid'>
                        <span>Started</span>
                        <span>Planned changes</span>
                        <span>State</span>
                        <span>Action</span>
                    </div>
                    {workspace.plans.map((plan) => (
                        <details
                            key={plan.id}
                            role='listitem'
                            className='group border-b border-[var(--dash-border)]'
                            onToggle={(event) => {
                                workspace.onPlanEvidenceVisibilityChange(plan, event.currentTarget.open);
                            }}>
                            <motion.summary
                                data-dashboard-disclosure
                                className='grid cursor-pointer list-none gap-2 px-2 py-4 marker:hidden md:grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] md:items-center md:gap-4'
                                {...dashboardTactile}>
                                <span className='text-sm text-[var(--dash-text-muted)]'>
                                    {formatDate(plan.createdAt)}
                                </span>
                                <span className='text-sm text-[var(--dash-text)]'>
                                    {plan.changeCount} changes · {plan.planStepCount} plan steps ·{' '}
                                    {plan.summary.creates} create · {plan.summary.updates} update ·{' '}
                                    {plan.summary.deletes} delete
                                </span>
                                <span className='text-sm text-[var(--dash-text-muted)]'>{formatRunStatus(plan)}</span>
                                <span className='text-sm font-medium text-[var(--dash-primary)]'>Open plan</span>
                            </motion.summary>
                            <div className='pb-5'>
                                <Suspense
                                    fallback={
                                        <p role='status' className='px-2 py-4 text-sm text-[var(--dash-text-muted)]'>
                                            Loading run details…
                                        </p>
                                    }>
                                    <DashboardBlueprintHistory
                                        plans={[plan]}
                                        latestPlan={workspace.latestPlan}
                                        busyAction={workspace.busyAction}
                                        preflightByPlanId={workspace.preflightByPlanId}
                                        onPreflight={workspace.onPreflightRun}
                                        onControl={workspace.onControlRun}
                                        onLoadPlanSteps={workspace.onLoadPlanSteps}
                                        onLoadDecisions={workspace.onLoadPlanDecisions}
                                        onRecoveryPlan={workspace.onRecoveryPlan}
                                    />
                                </Suspense>
                                {workspace.runProgressIssue?.planId === plan.id ? (
                                    <DashboardBlueprintRunIssue
                                        code={workspace.runProgressIssue.code}
                                        message={formatDashboardBlueprintRunIssue(workspace.runProgressIssue.code)}
                                        retrying={workspace.runProgressRetrying}
                                        retryLabel='Retry progress'
                                        onRetry={workspace.onRetryRunProgress}
                                    />
                                ) : null}
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </section>
    );
}

function formatRunStatus(plan: DashboardBlueprintPlan): string {
    if (plan.run) {
        switch (plan.run.status) {
            case 'succeeded':
                return 'Applied and verified';
            case 'partially_applied':
                return 'Partially applied';
            case 'failed_before_mutation':
                return 'Stopped before server changes';
            case 'needs_reconciliation':
                return 'Deployment needs review';
            case 'outcome_unknown':
                return 'Server outcome unknown';
            case 'cancelled':
                return 'Cancelled';
            default:
                return formatDashboardBlueprintRunState(plan.run);
        }
    }

    switch (plan.status) {
        case 'review_ready':
            return 'Waiting for review';
        case 'approved':
            return 'Waiting for safety check';
        default:
            return plan.status.replaceAll('_', ' ');
    }
}
