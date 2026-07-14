import { motion } from 'motion/react';

import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import { formatDashboardStructureExecutionState } from '../server/dashboard-structure-contracts.js';
import {
    DashboardStructureExecutionIssue,
    formatDashboardStructureExecutionIssue,
} from './dashboard-structure-execution-issue.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { dashboardTactile } from './dashboard-motion.js';
import { formatDate } from './dashboard-structure-panel-format.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';
import { dashboardStructureSurfaceIdentity as surfaceIdentity } from './dashboard-structure-surface.js';

export type DashboardStructureRunsWorkspace = {
    busyAction: StructureBusyAction | undefined;
    deleteConfirmationByRunId: Record<string, string>;
    executionProgressIssue: { code: string; runId: string } | undefined;
    executionProgressRetrying: boolean;
    importRuns: DashboardStructureImportRun[];
    latestRun: DashboardStructureImportRun | undefined;
    preflightByRunId: Record<string, DashboardStructurePreflightView>;
    onApplyRun: (run: DashboardStructureImportRun) => void;
    onApprovePlan: (run: DashboardStructureImportRun) => void;
    onControlExecution: (run: DashboardStructureImportRun, request: 'pause' | 'resume' | 'cancel') => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onLoadRunActions: (run: DashboardStructureImportRun) => void;
    onLoadRunDecisions: (run: DashboardStructureImportRun) => void;
    onPreflightRun: (run: DashboardStructureImportRun) => void;
    onRecoveryPlan: (run: DashboardStructureImportRun) => void;
    onRetryExecutionProgress: () => void;
};

export function DashboardStructureRunsSurface({ workspace }: { workspace: DashboardStructureRunsWorkspace }) {
    return (
        <section aria-labelledby='blueprint-runs-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-runs-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    {surfaceIdentity.runs.heading}
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.runs.description}</p>
            </div>
            {workspace.importRuns.length === 0 ? (
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
                    {workspace.importRuns.map((run) => (
                        <details key={run.id} role='listitem' className='group border-b border-[var(--dash-border)]'>
                            <motion.summary
                                data-dashboard-disclosure
                                className='grid cursor-pointer list-none gap-2 px-2 py-4 marker:hidden md:grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] md:items-center md:gap-4'
                                {...dashboardTactile}>
                                <span className='text-sm text-[var(--dash-text-muted)]'>
                                    {formatDate(run.createdAt)}
                                </span>
                                <span className='text-sm text-[var(--dash-text)]'>
                                    {run.actionCount} changes · {run.executionActionCount} execution steps ·{' '}
                                    {run.summary.creates} create · {run.summary.updates} update · {run.summary.deletes}{' '}
                                    delete
                                </span>
                                <span className='text-sm text-[var(--dash-text-muted)]'>{formatRunStatus(run)}</span>
                                <span className='text-sm font-medium text-[var(--dash-primary)]'>Open run</span>
                            </motion.summary>
                            <div className='pb-5'>
                                <DashboardStructureImportHistory
                                    runs={[run]}
                                    latestRun={workspace.latestRun}
                                    busyAction={workspace.busyAction}
                                    preflightByRunId={workspace.preflightByRunId}
                                    deleteConfirmationByRunId={workspace.deleteConfirmationByRunId}
                                    onDeleteConfirmationChange={workspace.onDeleteConfirmationChange}
                                    onApprove={workspace.onApprovePlan}
                                    onPreflight={workspace.onPreflightRun}
                                    onApply={workspace.onApplyRun}
                                    onControl={workspace.onControlExecution}
                                    onLoadActions={workspace.onLoadRunActions}
                                    onLoadDecisions={workspace.onLoadRunDecisions}
                                    onRecoveryPlan={workspace.onRecoveryPlan}
                                />
                                {workspace.executionProgressIssue?.runId === run.id ? (
                                    <DashboardStructureExecutionIssue
                                        code={workspace.executionProgressIssue.code}
                                        message={formatDashboardStructureExecutionIssue(
                                            workspace.executionProgressIssue.code
                                        )}
                                        retrying={workspace.executionProgressRetrying}
                                        retryLabel='Retry progress'
                                        onRetry={workspace.onRetryExecutionProgress}
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

function formatRunStatus(run: DashboardStructureImportRun): string {
    if (run.execution) {
        switch (run.execution.status) {
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
                return formatDashboardStructureExecutionState(run.execution);
        }
    }

    switch (run.status) {
        case 'review_ready':
            return 'Waiting for review';
        case 'approved':
            return 'Waiting for safety check';
        default:
            return run.status.replaceAll('_', ' ');
    }
}
