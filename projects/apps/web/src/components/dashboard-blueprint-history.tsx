import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../dashboard-blueprint-run-protocol.js';
import type { DashboardBlueprintPlanStep, DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    formatDashboardBlueprintRunPhase,
    formatDashboardBlueprintRunState,
} from '../server/dashboard-blueprint-contracts.js';
import type { BlueprintBusyAction, DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardListItemVariants,
    dashboardListTransition,
    dashboardTactile,
} from './dashboard-motion.js';
import {
    dashboardCompactFieldClassName,
    dashboardDangerActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

const DashboardBlueprintDeployReview = lazy(() =>
    import('./dashboard-blueprint-deploy-review.js').then((module) => ({
        default: module.DashboardBlueprintDeployReview,
    }))
);

export function DashboardBlueprintHistory({
    plans,
    latestPlan,
    busyAction,
    preflightByPlanId,
    onPreflight,
    onControl,
    onLoadPlanSteps,
    onLoadDecisions,
    onInspectPlanStep,
    onRecoveryPlan,
}: {
    plans: DashboardBlueprintPlan[];
    latestPlan: DashboardBlueprintPlan | undefined;
    busyAction: BlueprintBusyAction | undefined;
    preflightByPlanId: Record<string, DashboardBlueprintPreflightView>;
    onPreflight: (plan: DashboardBlueprintPlan) => void;
    onControl: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadDecisions: (plan: DashboardBlueprintPlan) => void;
    onInspectPlanStep?: (plan: DashboardBlueprintPlan, action: DashboardBlueprintPlanStep) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
}) {
    if (plans.length === 0) {
        return <p className='text-sm leading-6 text-[var(--dash-text-muted)]'>No deployment plans yet.</p>;
    }

    return (
        <div className='space-y-3'>
            {plans.map((plan) => (
                <PlanCard
                    key={plan.id}
                    plan={plan}
                    isLatest={latestPlan?.id === plan.id}
                    busyAction={busyAction}
                    preflightReport={preflightByPlanId[plan.id]}
                    onPreflight={onPreflight}
                    onControl={onControl}
                    onLoadPlanSteps={onLoadPlanSteps}
                    onLoadDecisions={onLoadDecisions}
                    onInspectPlanStep={onInspectPlanStep}
                    onRecoveryPlan={onRecoveryPlan}
                />
            ))}
        </div>
    );
}

export function DashboardBlueprintActiveDeployment({
    plan,
    busyAction,
    preflightReport,
    confirmation,
    targetGuildName,
    onPreflight,
    onControl,
    onLoadPlanSteps,
    onLoadDecisions,
    onInspectPlanStep,
    onRecoveryPlan,
    journeyStep,
}: {
    plan: DashboardBlueprintPlan;
    busyAction: BlueprintBusyAction | undefined;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    confirmation: DashboardBlueprintConfirmationDraft | undefined;
    targetGuildName: string;
    onPreflight: (plan: DashboardBlueprintPlan) => void;
    onControl: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadDecisions: (plan: DashboardBlueprintPlan) => void;
    onInspectPlanStep?: (plan: DashboardBlueprintPlan, action: DashboardBlueprintPlanStep) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
    journeyStep: DashboardBlueprintDeployJourneyStep;
}) {
    return (
        <PlanCard
            plan={plan}
            isLatest
            busyAction={busyAction}
            preflightReport={preflightReport}
            confirmation={confirmation}
            targetGuildName={targetGuildName}
            onPreflight={onPreflight}
            onControl={onControl}
            onLoadPlanSteps={onLoadPlanSteps}
            onLoadDecisions={onLoadDecisions}
            onInspectPlanStep={onInspectPlanStep}
            onRecoveryPlan={onRecoveryPlan}
            activeJourneyStep={journeyStep}
        />
    );
}

function PlanCard({
    plan,
    isLatest,
    busyAction,
    preflightReport,
    confirmation,
    targetGuildName,
    onPreflight,
    onControl,
    onLoadPlanSteps,
    onLoadDecisions,
    onInspectPlanStep,
    onRecoveryPlan,
    activeJourneyStep,
}: {
    plan: DashboardBlueprintPlan;
    isLatest: boolean;
    busyAction: BlueprintBusyAction | undefined;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    confirmation?: DashboardBlueprintConfirmationDraft;
    targetGuildName?: string;
    onPreflight: (plan: DashboardBlueprintPlan) => void;
    onControl: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadDecisions: (plan: DashboardBlueprintPlan) => void;
    onInspectPlanStep?: (plan: DashboardBlueprintPlan, action: DashboardBlueprintPlanStep) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
    activeJourneyStep?: DashboardBlueprintDeployJourneyStep;
}) {
    const isRecoveryBusy = busyAction === `recovery:${plan.id}`;
    const hasChanges = plan.planStepCount > 0;
    const canRecover = plan.recoveryAvailable === true;

    return (
        <motion.div
            data-dashboard-motion='list-insert'
            className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-3'
            aria-current={isLatest ? 'true' : undefined}
            variants={dashboardListItemVariants}
            initial='initial'
            animate='enter'
            transition={dashboardListTransition}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Plan {formatDate(plan.createdAt)}</p>
                    <p className='mt-1 text-xs text-[var(--dash-text-subtle)]'>{formatRunDisplayStatus(plan)}</p>
                </div>
                <p className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] px-2 py-1 text-xs font-semibold text-[var(--dash-text)]'>
                    {plan.changeCount} changes · {plan.planStepCount} plan steps
                </p>
            </div>
            <p className='mt-3 text-sm text-[var(--dash-text)]'>
                {plan.summary.creates} create, {plan.summary.updates} update, {plan.summary.deletes} delete
            </p>
            <p className='mt-1 text-xs font-medium text-[var(--dash-primary)]'>{formatPolicy(plan.policy)}</p>
            {!hasChanges ? (
                <p className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] p-3 text-sm font-semibold text-[var(--dash-success)]'>
                    Already matches — no deployment is needed.
                </p>
            ) : null}
            {plan.planBlockerCount > 0 ? (
                <p
                    role='alert'
                    className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-3 text-sm text-[var(--dash-danger)]'>
                    This plan has {plan.planBlockerCount} blocked{' '}
                    {plan.planBlockerCount === 1 ? 'decision.' : 'decisions.'} Resolve the source blueprint and create a
                    new plan before continuing.
                </p>
            ) : null}
            <DecisionSummary
                plan={plan}
                loading={busyAction === `decisions:${plan.id}`}
                onLoad={() => onLoadDecisions(plan)}
            />
            {plan.run ? (
                <RunProgress
                    plan={plan.run}
                    busy={busyAction === `control:${plan.id}`}
                    refreshingSafety={busyAction === `preflight:${plan.id}`}
                    showSafeStopRecovery={activeJourneyStep === 'deploy'}
                    onControl={(request) => onControl(plan, request)}
                    onRefreshSafetyCheck={() => onPreflight(plan)}
                />
            ) : null}
            {plan.verification ? <VerificationResult verification={plan.verification} /> : null}
            {hasChanges && activeJourneyStep && activeJourneyStep !== 'deploy' ? (
                <Suspense
                    fallback={
                        <p role='status' className='mt-3 text-sm text-[var(--dash-text-muted)]'>
                            Loading deployment review…
                        </p>
                    }>
                    <DashboardBlueprintDeployReview
                        plan={plan}
                        busyAction={busyAction}
                        preflightReport={preflightReport}
                        confirmation={confirmation}
                        targetGuildName={targetGuildName ?? ''}
                        onLoadPlanSteps={onLoadPlanSteps}
                        onInspectPlanStep={onInspectPlanStep}
                        journeyStep={activeJourneyStep}
                    />
                </Suspense>
            ) : null}
            <AnimatePresence initial={false} mode='popLayout'>
                {canRecover ? (
                    <motion.div
                        key='recover'
                        data-dashboard-motion='confirmation'
                        className='mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-3'
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        <p className='min-w-0 flex-1 text-xs leading-5 text-[var(--dash-text)]'>
                            Recovery re-reads the live server and creates a new Match blueprint plan from the remaining
                            differences.
                        </p>
                        <motion.button
                            type='button'
                            onClick={() => onRecoveryPlan(plan)}
                            disabled={Boolean(busyAction)}
                            className={dashboardDangerActionClassName}
                            {...dashboardTactile}>
                            {isRecoveryBusy ? 'Creating recovery plan' : 'Create recovery plan'}
                        </motion.button>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </motion.div>
    );
}

function DecisionSummary({
    plan,
    loading,
    onLoad,
}: {
    plan: DashboardBlueprintPlan;
    loading: boolean;
    onLoad: () => void;
}) {
    const [classification, setClassification] = useState('all');
    const visible = Object.entries(plan.decisionSummary).filter(([, count]) => count > 0);
    const total = visible.reduce((sum, [, count]) => sum + count, 0);
    const filtered =
        classification === 'all'
            ? plan.decisions
            : plan.decisions.filter((decision) => decision.classification === classification);

    return (
        <details className='mt-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-3'>
            <summary
                data-dashboard-disclosure
                className='cursor-pointer rounded-sm text-xs font-semibold text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                Full projected result · {total} decisions
            </summary>
            <div className='mt-3 flex flex-wrap gap-2'>
                {visible.map(([decisionClassification, count]) => (
                    <span
                        key={decisionClassification}
                        className='rounded border border-[var(--dash-border-strong)] px-2 py-1 text-[11px] text-[var(--dash-text-muted)]'>
                        {decisionClassification.replaceAll('-', ' ')}: {count}
                    </span>
                ))}
            </div>
            <label className='mt-3 block text-xs text-[var(--dash-text-muted)]'>
                Filter decisions
                <select
                    value={classification}
                    onChange={(event) => setClassification(event.currentTarget.value)}
                    className={`ml-2 inline-block w-auto ${dashboardCompactFieldClassName}`}>
                    <option value='all'>All</option>
                    {visible.map(([value]) => (
                        <option key={value} value={value}>
                            {value.replaceAll('-', ' ')}
                        </option>
                    ))}
                </select>
            </label>
            {filtered.length > 0 ? (
                <ul className='mt-3 max-h-[min(18rem,45dvh)] space-y-1 overflow-y-auto text-xs text-[var(--dash-text-muted)]'>
                    {filtered.map((decision) => (
                        <li
                            key={decision.logicalId}
                            className='flex justify-between gap-3 border-t border-[var(--dash-border)] py-2'>
                            <span className='min-w-0 truncate'>{decision.name}</span>
                            <span className='shrink-0 text-[var(--dash-text)]'>
                                {decision.classification.replaceAll('-', ' ')}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className='mt-3 text-xs text-[var(--dash-text-subtle)]'>No loaded decisions match this filter.</p>
            )}
            {plan.decisions.length < total ? (
                <button
                    type='button'
                    onClick={onLoad}
                    disabled={loading}
                    className={`mt-3 ${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                    {loading
                        ? 'Loading decisions'
                        : plan.decisions.length === 0
                          ? 'Load decisions'
                          : 'Load more decisions'}
                </button>
            ) : null}
        </details>
    );
}

function formatPolicy(policy: DashboardBlueprintPlan['policy']): string {
    if (policy === 'merge') return 'Merge without deletions';
    if (policy === 'rebuild') return 'Reset and rebuild';
    return 'Match blueprint';
}

function RunProgress({
    plan,
    busy,
    onControl,
    onRefreshSafetyCheck,
    refreshingSafety,
    showSafeStopRecovery,
}: {
    plan: NonNullable<DashboardBlueprintPlan['run']>;
    busy: boolean;
    onControl: (request: 'pause' | 'resume' | 'cancel') => void;
    onRefreshSafetyCheck: () => void;
    refreshingSafety: boolean;
    showSafeStopRecovery: boolean;
}) {
    const percent = plan.totalSteps > 0 ? Math.round((plan.completedSteps / plan.totalSteps) * 100) : 0;
    const hasCompatibleProtocol = plan.protocolVersion === BLUEPRINT_RUN_PROTOCOL_VERSION;
    const controlsDisabled = busy || !hasCompatibleProtocol;
    const outcome = formatRunOutcome(plan.status);
    const terminal = outcome !== 'Pending';
    return (
        <div
            className='mt-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-3'
            role='status'>
            <div className='flex flex-wrap items-center justify-between gap-3 text-xs'>
                <strong className='text-[var(--dash-text)]'>{formatDashboardBlueprintRunState(plan)}</strong>
                <span className='text-[var(--dash-text-muted)]'>
                    {plan.completedSteps} / {plan.totalSteps} steps
                </span>
            </div>
            <progress
                className='sr-only'
                value={plan.completedSteps}
                max={Math.max(1, plan.totalSteps)}
                aria-label={`${plan.phase.replaceAll('_', ' ')} progress: ${percent}%`}
            />
            <div
                className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dash-surface-muted)]'
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
                className='mt-3 grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-3 lg:grid-cols-6'
                aria-label='Deployment timeline'>
                {['Queued', 'Creating restore point', 'Authorizing', 'Applying', 'Verifying', 'Complete'].map(
                    (label, index) => (
                        <li
                            key={label}
                            aria-current={readRunTimelineIndex(plan) === index ? 'step' : undefined}
                            className={`rounded-[var(--dash-radius-control)] border px-2 py-1.5 ${
                                readRunTimelineIndex(plan) >= index
                                    ? 'border-[color:var(--dash-primary)]/40 text-[var(--dash-text)]'
                                    : 'border-[var(--dash-border)] text-[var(--dash-text-subtle)]'
                            }`}>
                            {index + 1}. {label}
                        </li>
                    )
                )}
            </ol>
            <dl className='mt-3 grid gap-3 text-xs sm:grid-cols-3'>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Operation</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>
                        {plan.currentStepLabel ?? formatDashboardBlueprintRunPhase(plan.phase)}
                        {plan.retryAt ? ` · resumes ${formatDate(plan.retryAt)}` : ''}
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Outcome</dt>
                    <motion.dd
                        key={outcome}
                        data-dashboard-motion='confirmation'
                        className={`mt-1 ${getRunOutcomeClassName(plan.status)}`}
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        {outcome}
                    </motion.dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Plan record updated</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>{formatDate(plan.completedAt ?? plan.updatedAt)}</dd>
                </div>
            </dl>
            {plan.status === 'failed_before_mutation' ? (
                <SafeStopSummary
                    run={plan}
                    refreshingSafety={refreshingSafety}
                    showRecovery={showSafeStopRecovery}
                    onRefreshSafetyCheck={onRefreshSafetyCheck}
                />
            ) : null}
            <details className='mt-3 border-t border-[var(--dash-border)] pt-2 text-[11px] text-[var(--dash-text-subtle)]'>
                <summary
                    data-dashboard-disclosure
                    className='cursor-pointer rounded-sm text-xs text-[var(--dash-text-muted)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    Plan timestamps
                </summary>
                <ol className='mt-2 grid gap-1 border-l border-[var(--dash-border-strong)] pl-3'>
                    <li>Queued {formatDate(plan.createdAt)}</li>
                    {plan.startedAt ? <li>Started {formatDate(plan.startedAt)}</li> : null}
                    {terminal && plan.completedAt ? <li>Completed {formatDate(plan.completedAt)}</li> : null}
                </ol>
            </details>
            {plan.failedSteps > 0 || plan.errorType ? (
                <p className='mt-2 text-xs text-[var(--dash-danger)]'>
                    {plan.failedSteps} failed{plan.errorType ? ` · ${plan.errorType}` : ''}
                </p>
            ) : null}
            {!hasCompatibleProtocol ? (
                <p className='mt-2 text-xs text-[var(--dash-warning)]'>
                    This deployment was created by a different NeonFlux version. Open it with the matching version to
                    resume or control it.
                </p>
            ) : null}
            <div className='mt-3 flex flex-wrap gap-2'>
                {['running', 'waiting_rate_limit'].includes(plan.status) ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('pause')}
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Pause deployment
                    </motion.button>
                ) : null}
                {plan.status === 'paused' ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('resume')}
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Resume deployment
                    </motion.button>
                ) : null}
                {['queued', 'paused'].includes(plan.status) ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('cancel')}
                        className={`${dashboardDangerActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Cancel {plan.status === 'queued' ? 'queued' : 'paused'} deployment
                    </motion.button>
                ) : null}
            </div>
        </div>
    );
}

function readRunTimelineIndex(run: NonNullable<DashboardBlueprintPlan['run']>): number {
    if (run.status === 'failed_before_mutation') return 2;
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
    onRefreshSafetyCheck,
    refreshingSafety,
    showRecovery,
}: {
    run: NonNullable<DashboardBlueprintPlan['run']>;
    onRefreshSafetyCheck: () => void;
    refreshingSafety: boolean;
    showRecovery: boolean;
}) {
    const changed = readAuthorizationChangedCounts(run.authorizationMismatch);
    return (
        <div className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-3'>
            <p className='text-sm font-semibold text-[var(--dash-text)]'>Deployment stopped safely</p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                {formatAuthorizationDecision(run.authorizationDecision)} NeonFlux stopped before applying the first
                change.
            </p>
            <dl className='mt-3 grid gap-2 text-xs sm:grid-cols-3'>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Changes applied</dt>
                    <dd className='font-semibold text-[var(--dash-text)]'>0 of {run.totalSteps}</dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Restore point</dt>
                    <dd className='font-semibold text-[var(--dash-text)]'>
                        {run.restorePointBackupId ? 'Created' : 'Not created'} · Restore required: No
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Observed</dt>
                    <dd className='font-semibold text-[var(--dash-text)]'>{formatDate(run.updatedAt)}</dd>
                </div>
            </dl>
            {changed ? (
                <p className='mt-2 text-xs text-[var(--dash-text-muted)]'>
                    Roles changed: {changed.roles} · Categories changed: {changed.categories} · Channels changed:{' '}
                    {changed.channels}
                </p>
            ) : null}
            {showRecovery ? (
                <button
                    type='button'
                    onClick={onRefreshSafetyCheck}
                    disabled={refreshingSafety}
                    className={`mt-3 ${dashboardSecondaryActionClassName}`}>
                    {refreshingSafety ? 'Refreshing safety check' : 'Refresh safety check'}
                </button>
            ) : null}
            <details className='mt-2 text-xs text-[var(--dash-text-subtle)]'>
                <summary className='cursor-pointer'>Technical details</summary>
                <code className='mt-1 block'>{run.errorType ?? run.authorizationDecision ?? 'safe-stop'}</code>
            </details>
        </div>
    );
}

function formatAuthorizationDecision(decision: NonNullable<DashboardBlueprintPlan['run']>['authorizationDecision']) {
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

function formatRunOutcome(status: NonNullable<DashboardBlueprintPlan['run']>['status']): string {
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

function getRunOutcomeClassName(status: NonNullable<DashboardBlueprintPlan['run']>['status']): string {
    if (status === 'succeeded') return 'text-[var(--dash-success)]';
    if (status === 'failed_before_mutation' || status === 'cancelled') return 'text-[var(--dash-text-muted)]';
    if (status === 'partially_applied' || status === 'needs_reconciliation' || status === 'outcome_unknown') {
        return 'text-[var(--dash-danger)]';
    }
    return 'text-[var(--dash-warning)]';
}

function VerificationResult({ verification }: { verification: NonNullable<DashboardBlueprintPlan['verification']> }) {
    if (verification.status === 'matched') {
        return (
            <p className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] p-3 text-xs text-[var(--dash-success)]'>
                Post-apply verification matched the projected result.
            </p>
        );
    }

    if (verification.status === 'read-failed') {
        return (
            <p className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-3 text-xs leading-5 text-[var(--dash-danger)]'>
                Post-apply verification could not read the server. The apply result is not verified.
            </p>
        );
    }

    return (
        <div className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-3 text-xs text-[var(--dash-danger)]'>
            <p>Post-apply verification did not match the projected result.</p>
        </div>
    );
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function formatStatus(status: string): string {
    return status.replaceAll('_', ' ');
}

function formatRunDisplayStatus(plan: DashboardBlueprintPlan): string {
    if (!plan.run) return formatStatus(plan.status);

    const outcome = formatRunOutcome(plan.run.status);

    return outcome === 'Pending' ? formatDashboardBlueprintRunState(plan.run) : outcome;
}
