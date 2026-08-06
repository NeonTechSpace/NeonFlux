import { motion } from 'motion/react';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../dashboard-blueprint-run-protocol.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    formatDashboardBlueprintRunPhase,
    formatDashboardBlueprintRunState,
} from '../server/dashboard-blueprint-contracts.js';
import { dashboardConfirmationTransition } from './dashboard-motion.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

type Run = NonNullable<DashboardBlueprintPlan['run']>;

export function DashboardBlueprintDeployRun({
    busy,
    plan,
    refreshingSafety,
    onCreateRestorePlan,
    onRecoveryPlan,
    onRefreshSafetyCheck,
}: {
    busy: boolean;
    plan: DashboardBlueprintPlan;
    refreshingSafety: boolean;
    onCreateRestorePlan: (backupId: string) => void;
    onRecoveryPlan: () => void;
    onRefreshSafetyCheck: () => void;
}) {
    const run = plan.run;
    if (!run) return null;

    const percent = run.totalSteps > 0 ? Math.round((run.completedSteps / run.totalSteps) * 100) : 0;
    const compatible = run.protocolVersion === BLUEPRINT_RUN_PROTOCOL_VERSION;
    const outcome = formatRunOutcome(run.status);
    const terminal = outcome !== 'Pending';
    const restoreState = readRestorePointState(run);

    return (
        <section
            aria-labelledby='blueprint-active-run-heading'
            className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-4 sm:p-5'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h3 id='blueprint-active-run-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                        {formatDashboardBlueprintRunState(run)}
                    </h3>
                    <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                        {run.completedSteps} of {run.totalSteps} steps complete
                    </p>
                </div>
                <span className={getRunOutcomeClassName(run.status)}>{outcome}</span>
            </div>

            <progress
                className='sr-only'
                value={run.completedSteps}
                max={Math.max(1, run.totalSteps)}
                aria-label={`${run.phase.replaceAll('_', ' ')} progress: ${percent}%`}
            />
            <div
                className='mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dash-surface-muted)]'
                aria-hidden='true'>
                <motion.div
                    data-dashboard-motion='confirmation'
                    className='h-full rounded-full bg-[var(--dash-primary)]'
                    initial={false}
                    animate={{ width: `${percent}%` }}
                    transition={dashboardConfirmationTransition}
                />
            </div>

            <ol
                className='mt-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3 xl:grid-cols-6'
                aria-label='Deployment timeline'>
                {['Queued', 'Saving restore point', 'Checking target', 'Applying', 'Verifying', 'Complete'].map(
                    (label, index) => (
                        <li
                            key={label}
                            aria-current={readRunTimelineIndex(run) === index ? 'step' : undefined}
                            className={`rounded-[var(--dash-radius-control)] border px-2.5 py-2 ${
                                readRunTimelineIndex(run) >= index
                                    ? 'border-[color:var(--dash-primary)]/40 text-[var(--dash-text)]'
                                    : 'border-[var(--dash-border)] text-[var(--dash-text-subtle)]'
                            }`}>
                            {index + 1}. {label}
                        </li>
                    )
                )}
            </ol>

            <dl className='mt-4 grid gap-4 text-xs sm:grid-cols-2 xl:grid-cols-4'>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Current operation</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>
                        {run.currentStepLabel ?? formatDashboardBlueprintRunPhase(run.phase)}
                        {run.retryAt ? ` · resumes ${formatDate(run.retryAt)}` : ''}
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Restore point</dt>
                    <dd aria-label='Restore point status' className={`mt-1 font-semibold ${restoreState.className}`}>
                        {restoreState.label}
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Failed or skipped</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>
                        {run.failedSteps} failed
                        {typeof run.notStartedSteps === 'number' ? ` · ${run.notStartedSteps} not started` : ''}
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Last update</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>{formatDate(run.completedAt ?? run.updatedAt)}</dd>
                </div>
            </dl>

            {run.status === 'failed_before_mutation' ? (
                <SafeStopSummary
                    run={run}
                    refreshingSafety={refreshingSafety}
                    onRefreshSafetyCheck={onRefreshSafetyCheck}
                />
            ) : null}

            {plan.verification ? <VerificationResult verification={plan.verification} /> : null}

            {plan.recoveryAvailable ? (
                <div className='mt-4 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-3'>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Recovery is available</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Re-read the live server and create a new Match plan from the remaining differences.
                    </p>
                    <button
                        type='button'
                        onClick={onRecoveryPlan}
                        disabled={busy}
                        className={`mt-3 ${dashboardPrimaryActionClassName}`}>
                        {busy ? 'Creating recovery plan' : 'Create recovery plan'}
                    </button>
                </div>
            ) : null}

            {!compatible ? (
                <p className='mt-4 text-xs text-[var(--dash-warning)]'>
                    This deployment was created by a different NeonFlux version. Open it with the matching version to
                    resume or control it.
                </p>
            ) : null}

            {canCreateRestorePlan(run) && run.restorePointBackupId ? (
                <button
                    type='button'
                    disabled={busy}
                    onClick={() => onCreateRestorePlan(run.restorePointBackupId ?? '')}
                    className={`mt-4 ${dashboardSecondaryActionClassName}`}>
                    Create restore plan
                </button>
            ) : null}

            <details className='mt-4 border-t border-[var(--dash-border)] pt-3 text-xs text-[var(--dash-text-subtle)]'>
                <summary className='cursor-pointer rounded-sm text-[var(--dash-text-muted)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    Timestamps and technical details
                </summary>
                <ol className='mt-2 grid gap-1 border-l border-[var(--dash-border-strong)] pl-3'>
                    <li>Queued {formatDate(run.createdAt)}</li>
                    {run.startedAt ? <li>Started {formatDate(run.startedAt)}</li> : null}
                    {terminal && run.completedAt ? <li>Completed {formatDate(run.completedAt)}</li> : null}
                    {run.errorType ? <li>Error: {run.errorType}</li> : null}
                </ol>
            </details>
        </section>
    );
}

function readRestorePointState(run: Run): { label: string; className: string } {
    if (run.restorePointBackupId) return { label: 'Saved', className: 'text-[var(--dash-success)]' };
    if (run.phase === 'preparing') return { label: 'Saving', className: 'text-[var(--dash-text)]' };
    if (run.status === 'failed_before_mutation' || run.status === 'cancelled') {
        return { label: 'Not created', className: 'text-[var(--dash-text-muted)]' };
    }
    return { label: 'Pending', className: 'text-[var(--dash-text-muted)]' };
}

function canCreateRestorePlan(run: Run): boolean {
    return ['succeeded', 'cancelled'].includes(run.status);
}

function readRunTimelineIndex(run: Run): number {
    if (run.status === 'failed_before_mutation') return run.restorePointBackupId ? 2 : 1;
    if (
        ['succeeded', 'partially_applied', 'needs_reconciliation', 'outcome_unknown', 'cancelled'].includes(run.status)
    ) {
        return 5;
    }
    if (run.phase === 'verifying') return 4;
    if (
        ['create', 'update', 'delete', 'channel_order', 'role_order', 'waiting_rate_limit', 'paused'].includes(
            run.phase
        )
    ) {
        return 3;
    }
    if (run.authorizationDecision === 'authorized') return 3;
    if (run.restorePointBackupId) return 2;
    if (run.phase === 'preparing') return 1;
    return 0;
}

function SafeStopSummary({
    run,
    refreshingSafety,
    onRefreshSafetyCheck,
}: {
    run: Run;
    refreshingSafety: boolean;
    onRefreshSafetyCheck: () => void;
}) {
    const changed = readAuthorizationChangedCounts(run.authorizationMismatch);
    return (
        <div className='mt-4 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-3'>
            <p className='text-sm font-semibold text-[var(--dash-text)]'>Deployment stopped safely</p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                {formatAuthorizationDecision(run.authorizationDecision)} NeonFlux stopped before applying the first
                change.
            </p>
            <p className='mt-2 text-xs font-semibold text-[var(--dash-text)]'>
                0 of {run.totalSteps} changes applied · Restore required: No
            </p>
            {changed ? (
                <p className='mt-2 text-xs text-[var(--dash-text-muted)]'>
                    Roles changed: {changed.roles} · Categories changed: {changed.categories} · Channels changed:{' '}
                    {changed.channels}
                </p>
            ) : null}
            <button
                type='button'
                onClick={onRefreshSafetyCheck}
                disabled={refreshingSafety}
                className={`mt-3 ${dashboardSecondaryActionClassName}`}>
                {refreshingSafety ? 'Refreshing safety check' : 'Refresh safety check'}
            </button>
        </div>
    );
}

function VerificationResult({ verification }: { verification: NonNullable<DashboardBlueprintPlan['verification']> }) {
    const matched = verification.status === 'matched';
    return (
        <div
            className={`mt-4 rounded-[var(--dash-radius-control)] border p-3 text-xs ${
                matched
                    ? 'border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] text-[var(--dash-success)]'
                    : 'border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] text-[var(--dash-danger)]'
            }`}>
            {matched
                ? 'Post-apply verification matched the projected result.'
                : verification.status === 'read-failed'
                  ? 'Post-apply verification could not read the server. The result is not verified.'
                  : 'Post-apply verification did not match the projected result.'}
        </div>
    );
}

function formatAuthorizationDecision(decision: Run['authorizationDecision']): string {
    if (decision === 'capability_changed') return 'The bot’s role or permissions changed after the safety check.';
    if (decision === 'structure_and_capability_changed') {
        return 'The target structure and the bot’s capabilities changed after the safety check.';
    }
    if (decision === 'restore_observation_diverged') {
        return 'The target changed while NeonFlux was securing the restore point.';
    }
    if (decision === 'preflight_expired') return 'The safety check expired before authorization.';
    if (decision === 'fingerprint_version_mismatch') {
        return 'This plan was checked by a different NeonFlux version. Create a new plan before continuing.';
    }
    return 'The target no longer matched the latest safety check.';
}

function readAuthorizationChangedCounts(value: Record<string, unknown> | undefined) {
    if (!value) return undefined;
    const count = (key: string): number => {
        const collection = value[key];
        if (!collection || typeof collection !== 'object') return 0;
        const record = collection as Record<string, unknown>;
        return ['addedCount', 'removedCount', 'changedCount'].reduce(
            (total, field) => total + (typeof record[field] === 'number' ? record[field] : 0),
            0
        );
    };
    return { roles: count('roles'), categories: count('categories'), channels: count('channels') };
}

function formatRunOutcome(status: Run['status']): string {
    switch (status) {
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
            return 'Pending';
    }
}

function getRunOutcomeClassName(status: Run['status']): string {
    if (status === 'succeeded') return 'text-sm font-semibold text-[var(--dash-success)]';
    if (status === 'failed_before_mutation' || status === 'cancelled') {
        return 'text-sm font-semibold text-[var(--dash-text-muted)]';
    }
    if (['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(status)) {
        return 'text-sm font-semibold text-[var(--dash-danger)]';
    }
    return 'text-sm font-semibold text-[var(--dash-warning)]';
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}
