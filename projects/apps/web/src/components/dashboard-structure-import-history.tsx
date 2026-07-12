import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import {
    formatDashboardStructureExecutionPhase,
    formatDashboardStructureExecutionState,
} from '../server/dashboard-structure-contracts.js';
import { DashboardStructureApplyControls } from './dashboard-structure-apply-controls.js';
import {
    DashboardStructureActionInspector,
    DashboardStructureActionPreview,
} from './dashboard-structure-action-inspection.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardInlineVariants,
    dashboardListItemVariants,
    dashboardListTransition,
    dashboardTactile,
    dashboardViewTransition,
} from './dashboard-motion.js';
import {
    dashboardCompactFieldClassName,
    dashboardDangerActionClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

export type StructureBusyAction =
    | 'export'
    | 'backup'
    | 'backup-settings'
    | 'drift'
    | 'explorer-live'
    | 'explorer-compare-live'
    | 'explorer-compare-baseline'
    | `backup-json:${string}`
    | 'backup-page'
    | `backup-drift:${string}`
    | `backup-rename:${string}`
    | `backup-delete:${string}`
    | `backup-import:${string}`
    | 'plan'
    | `actions:${string}`
    | `decisions:${string}`
    | `approval:${string}`
    | `preflight:${string}`
    | `apply:${string}`
    | `control:${string}`
    | `recovery:${string}`;

export function DashboardStructureImportHistory({
    runs,
    latestRun,
    busyAction,
    preflightByRunId,
    deleteConfirmationByRunId,
    onDeleteConfirmationChange,
    onApprove,
    onPreflight,
    onApply,
    onControl,
    onLoadActions,
    onLoadDecisions,
    onInspectAction,
    onRecoveryPlan,
}: {
    runs: DashboardStructureImportRun[];
    latestRun: DashboardStructureImportRun | undefined;
    busyAction: StructureBusyAction | undefined;
    preflightByRunId: Record<string, DashboardStructurePreflightReport>;
    deleteConfirmationByRunId: Record<string, string>;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onApprove: (run: DashboardStructureImportRun) => void;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onApply: (run: DashboardStructureImportRun) => void;
    onControl: (run: DashboardStructureImportRun, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadActions: (run: DashboardStructureImportRun) => void;
    onLoadDecisions: (run: DashboardStructureImportRun) => void;
    onInspectAction?: (run: DashboardStructureImportRun, action: DashboardStructureImportAction) => void;
    onRecoveryPlan: (run: DashboardStructureImportRun) => void;
}) {
    if (runs.length === 0) {
        return <p className='text-sm leading-6 text-[var(--dash-text-muted)]'>No import dry-runs yet.</p>;
    }

    return (
        <div className='space-y-3'>
            {runs.map((run) => (
                <ImportRunCard
                    key={run.id}
                    run={run}
                    isLatest={latestRun?.id === run.id}
                    busyAction={busyAction}
                    preflightReport={preflightByRunId[run.id] ?? run.preflight?.report}
                    deleteConfirmation={deleteConfirmationByRunId[run.id] ?? ''}
                    onDeleteConfirmationChange={onDeleteConfirmationChange}
                    onApprove={onApprove}
                    onPreflight={onPreflight}
                    onApply={onApply}
                    onControl={onControl}
                    onLoadActions={onLoadActions}
                    onLoadDecisions={onLoadDecisions}
                    onInspectAction={onInspectAction}
                    onRecoveryPlan={onRecoveryPlan}
                />
            ))}
        </div>
    );
}

function ImportRunCard({
    run,
    isLatest,
    busyAction,
    preflightReport,
    deleteConfirmation,
    onDeleteConfirmationChange,
    onApprove,
    onPreflight,
    onApply,
    onControl,
    onLoadActions,
    onLoadDecisions,
    onInspectAction,
    onRecoveryPlan,
}: {
    run: DashboardStructureImportRun;
    isLatest: boolean;
    busyAction: StructureBusyAction | undefined;
    preflightReport: DashboardStructurePreflightReport | undefined;
    deleteConfirmation: string;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onApprove: (run: DashboardStructureImportRun) => void;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onApply: (run: DashboardStructureImportRun) => void;
    onControl: (run: DashboardStructureImportRun, request: 'pause' | 'resume' | 'cancel') => void;
    onLoadActions: (run: DashboardStructureImportRun) => void;
    onLoadDecisions: (run: DashboardStructureImportRun) => void;
    onInspectAction?: (run: DashboardStructureImportRun, action: DashboardStructureImportAction) => void;
    onRecoveryPlan: (run: DashboardStructureImportRun) => void;
}) {
    const [inspectedAction, setInspectedAction] = useState<DashboardStructureImportAction | undefined>();
    const isApprovalBusy = busyAction === `approval:${run.id}`;
    const isActionBusy = busyAction === `actions:${run.id}`;
    const isRecoveryBusy = busyAction === `recovery:${run.id}`;
    const canApprove = run.status === 'review_ready' && !run.execution;
    const canPreflight =
        run.status === 'approved' && (!run.execution || run.execution.status === 'failed_before_mutation');
    const canRecover = run.recoveryAvailable === true;

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
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Dry-run {formatDate(run.createdAt)}</p>
                    <p className='mt-1 text-xs text-[var(--dash-text-subtle)]'>{formatRunDisplayStatus(run)}</p>
                </div>
                <p className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] px-2 py-1 text-xs font-semibold text-[var(--dash-text)]'>
                    {run.actionCount} changes · {run.executionActionCount} execution steps
                </p>
            </div>
            <p className='mt-3 text-sm text-[var(--dash-text)]'>
                {run.summary.creates} create, {run.summary.updates} update, {run.summary.deletes} delete
            </p>
            <p className='mt-1 text-xs font-medium text-[var(--dash-primary)]'>{formatPolicy(run.policy)}</p>
            <DecisionSummary
                run={run}
                loading={busyAction === `decisions:${run.id}`}
                onLoad={() => onLoadDecisions(run)}
            />
            {run.execution ? (
                <ExecutionProgress
                    execution={run.execution}
                    busy={busyAction === `control:${run.id}`}
                    onControl={(request) => onControl(run, request)}
                />
            ) : null}
            {run.verification ? <VerificationResult verification={run.verification} /> : null}
            <DashboardStructureActionPreview
                actions={run.actions}
                actionCount={run.executionActionCount}
                isLoading={isActionBusy}
                onLoad={() => onLoadActions(run)}
                onInspectAction={(action) => {
                    setInspectedAction(action);
                    onInspectAction?.(run, action);
                }}
            />
            {inspectedAction ? (
                <motion.div
                    key={inspectedAction.id}
                    data-dashboard-motion='view-change'
                    variants={dashboardInlineVariants}
                    initial='initial'
                    animate='enter'
                    transition={dashboardViewTransition}>
                    <DashboardStructureActionInspector
                        action={inspectedAction}
                        onClose={() => setInspectedAction(undefined)}
                    />
                </motion.div>
            ) : null}
            <AnimatePresence initial={false} mode='popLayout'>
                {canApprove ? (
                    <motion.div
                        key='approve'
                        data-dashboard-motion='confirmation'
                        className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-3'
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        <p className='text-xs leading-5 text-[var(--dash-text)]'>
                            Approval is bound to this exact plan digest. Any refreshed plan requires a new review.
                        </p>
                        <div className='mt-2 flex justify-end'>
                            <motion.button
                                type='button'
                                onClick={() => onApprove(run)}
                                disabled={Boolean(busyAction)}
                                className={dashboardPrimaryActionClassName}
                                {...dashboardTactile}>
                                {isApprovalBusy ? 'Approving' : 'Approve reviewed plan'}
                            </motion.button>
                        </div>
                        <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            Approval is recorded separately from execution. No server changes are applied yet.
                        </p>
                    </motion.div>
                ) : null}
                {canPreflight ? (
                    <motion.div
                        key='preflight'
                        data-dashboard-motion='confirmation'
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        {run.execution?.status === 'failed_before_mutation' ? (
                            <p className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-3 text-xs leading-5 text-[var(--dash-warning)]'>
                                No server changes were made. Run a fresh safety check before queueing this approved plan
                                again.
                            </p>
                        ) : null}
                        <DashboardStructureApplyControls
                            run={run}
                            busyAction={busyAction}
                            preflightReport={preflightReport}
                            deleteConfirmation={deleteConfirmation}
                            onPreflight={onPreflight}
                            onDeleteConfirmationChange={onDeleteConfirmationChange}
                            onApply={onApply}
                        />
                    </motion.div>
                ) : null}
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
                            onClick={() => onRecoveryPlan(run)}
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
    run,
    loading,
    onLoad,
}: {
    run: DashboardStructureImportRun;
    loading: boolean;
    onLoad: () => void;
}) {
    const [classification, setClassification] = useState('all');
    const visible = Object.entries(run.decisionSummary).filter(([, count]) => count > 0);
    const total = visible.reduce((sum, [, count]) => sum + count, 0);
    const filtered =
        classification === 'all'
            ? run.decisions
            : run.decisions.filter((decision) => decision.classification === classification);

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
            {run.decisions.length < total ? (
                <button
                    type='button'
                    onClick={onLoad}
                    disabled={loading}
                    className={`mt-3 ${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                    {loading
                        ? 'Loading decisions'
                        : run.decisions.length === 0
                          ? 'Load decisions'
                          : 'Load more decisions'}
                </button>
            ) : null}
        </details>
    );
}

function formatPolicy(policy: DashboardStructureImportRun['policy']): string {
    if (policy === 'merge') return 'Merge additions only';
    if (policy === 'rebuild') return 'Reset and rebuild';
    return 'Match blueprint';
}

function ExecutionProgress({
    execution,
    busy,
    onControl,
}: {
    execution: NonNullable<DashboardStructureImportRun['execution']>;
    busy: boolean;
    onControl: (request: 'pause' | 'resume' | 'cancel') => void;
}) {
    const percent =
        execution.totalActions > 0 ? Math.round((execution.completedActions / execution.totalActions) * 100) : 0;
    const hasCompatibleProtocol = execution.protocolVersion === STRUCTURE_EXECUTION_PROTOCOL_VERSION;
    const controlsDisabled = busy || !hasCompatibleProtocol;
    const outcome = formatExecutionOutcome(execution.status);
    const terminal = outcome !== 'Pending';
    return (
        <div
            className='mt-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-3'
            role='status'>
            <div className='flex flex-wrap items-center justify-between gap-3 text-xs'>
                <strong className='text-[var(--dash-text)]'>{formatDashboardStructureExecutionState(execution)}</strong>
                <span className='text-[var(--dash-text-muted)]'>
                    {execution.completedActions} / {execution.totalActions} steps
                </span>
            </div>
            <progress
                className='sr-only'
                value={execution.completedActions}
                max={Math.max(1, execution.totalActions)}
                aria-label={`${execution.phase.replaceAll('_', ' ')} progress: ${percent}%`}
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
            <dl className='mt-3 grid gap-3 text-xs sm:grid-cols-3'>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Operation</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>
                        {execution.currentActionLabel ?? formatDashboardStructureExecutionPhase(execution.phase)}
                        {execution.retryAt ? ` · resumes ${formatDate(execution.retryAt)}` : ''}
                    </dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Outcome</dt>
                    <motion.dd
                        key={outcome}
                        data-dashboard-motion='confirmation'
                        className={`mt-1 ${getExecutionOutcomeClassName(execution.status)}`}
                        variants={dashboardConfirmationVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardConfirmationTransition}>
                        {outcome}
                    </motion.dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Execution record updated</dt>
                    <dd className='mt-1 text-[var(--dash-text)]'>
                        {formatDate(execution.completedAt ?? execution.updatedAt)}
                    </dd>
                </div>
            </dl>
            <details className='mt-3 border-t border-[var(--dash-border)] pt-2 text-[11px] text-[var(--dash-text-subtle)]'>
                <summary
                    data-dashboard-disclosure
                    className='cursor-pointer rounded-sm text-xs text-[var(--dash-text-muted)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    Execution timestamps
                </summary>
                <ol className='mt-2 grid gap-1 border-l border-[var(--dash-border-strong)] pl-3'>
                    <li>Queued {formatDate(execution.createdAt)}</li>
                    {execution.startedAt ? <li>Started {formatDate(execution.startedAt)}</li> : null}
                    {terminal && execution.completedAt ? <li>Completed {formatDate(execution.completedAt)}</li> : null}
                </ol>
            </details>
            {execution.failedActions > 0 || execution.errorType ? (
                <p className='mt-2 text-xs text-[var(--dash-danger)]'>
                    {execution.failedActions} failed{execution.errorType ? ` · ${execution.errorType}` : ''}
                </p>
            ) : null}
            {!hasCompatibleProtocol ? (
                <p className='mt-2 text-xs text-[var(--dash-warning)]'>
                    Deployment controls are disabled because this deployment uses a different Blueprint protocol.
                </p>
            ) : null}
            <div className='mt-3 flex flex-wrap gap-2'>
                {['running', 'waiting_rate_limit'].includes(execution.status) ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('pause')}
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Pause deployment
                    </motion.button>
                ) : null}
                {execution.status === 'paused' ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('resume')}
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Resume deployment
                    </motion.button>
                ) : null}
                {['queued', 'paused'].includes(execution.status) ? (
                    <motion.button
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => onControl('cancel')}
                        className={`${dashboardDangerActionClassName} min-h-8 text-xs`}
                        {...dashboardTactile}>
                        Cancel {execution.status === 'queued' ? 'queued' : 'paused'} deployment
                    </motion.button>
                ) : null}
            </div>
        </div>
    );
}

function formatExecutionOutcome(status: NonNullable<DashboardStructureImportRun['execution']>['status']): string {
    switch (status) {
        case 'succeeded':
            return 'Applied and verified';
        case 'partially_applied':
            return 'Partially applied';
        case 'failed_before_mutation':
            return 'Stopped before server changes';
        case 'needs_reconciliation':
            return 'Reconciliation required';
        case 'outcome_unknown':
            return 'Server outcome unknown';
        case 'cancelled':
            return 'Cancelled';
        default:
            return 'Pending';
    }
}

function getExecutionOutcomeClassName(status: NonNullable<DashboardStructureImportRun['execution']>['status']): string {
    if (status === 'succeeded') return 'text-[var(--dash-success)]';
    if (status === 'failed_before_mutation' || status === 'cancelled') return 'text-[var(--dash-text-muted)]';
    if (status === 'partially_applied' || status === 'needs_reconciliation' || status === 'outcome_unknown') {
        return 'text-[var(--dash-danger)]';
    }
    return 'text-[var(--dash-warning)]';
}

function VerificationResult({
    verification,
}: {
    verification: NonNullable<DashboardStructureImportRun['verification']>;
}) {
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
            <p>
                Post-apply verification found {verification.mismatchCount} projected result mismatch
                {verification.mismatchCount === 1 ? '' : 'es'}.
            </p>
            {verification.preview.length > 0 ? (
                <ul className='mt-2 space-y-1 font-mono text-[11px] text-[var(--dash-text)]'>
                    {verification.preview.map((mismatch) => (
                        <li
                            key={`${mismatch.logicalId}:${mismatch.field}:${formatVerificationValue(mismatch.expected)}:${formatVerificationValue(mismatch.actual)}`}>
                            {mismatch.logicalId}.{mismatch.field}: expected {formatVerificationValue(mismatch.expected)}
                            , got {formatVerificationValue(mismatch.actual)}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function formatVerificationValue(value: unknown): string {
    if (value === undefined) return 'missing';
    return JSON.stringify(value);
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

function formatRunDisplayStatus(run: DashboardStructureImportRun): string {
    if (!run.execution) return formatStatus(run.status);

    const outcome = formatExecutionOutcome(run.execution.status);

    return outcome === 'Pending' ? formatDashboardStructureExecutionState(run.execution) : outcome;
}
