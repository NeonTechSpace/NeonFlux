import {
    countDashboardStructurePreflightHardBlockers,
    isDashboardStructurePreflightReady,
} from '../server/dashboard-structure-preflight.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { getDashboardStructureDeleteApprovalText } from '../server/dashboard-structure-contracts.js';
import {
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
    DashboardStatus,
} from './dashboard-ui.js';

export function DashboardStructureApplyControls({
    run,
    busyAction,
    preflightReport,
    deleteConfirmation,
    onPreflight,
    onDeleteConfirmationChange,
    onApply,
}: {
    run: DashboardStructureImportRun;
    busyAction: string | undefined;
    preflightReport: DashboardStructurePreflightReport | undefined;
    deleteConfirmation: string;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onApply: (run: DashboardStructureImportRun) => void;
}) {
    const destructiveApprovalCount = preflightReport?.summary.destructiveApprovalRequired ?? 0;
    const expectedDeleteText = getDashboardStructureDeleteApprovalText(
        run.id,
        destructiveApprovalCount,
        run.deleteSetDigest ?? ''
    );
    const isPreflightBusy = busyAction === `preflight:${run.id}`;
    const isApplyBusy = busyAction === `apply:${run.id}`;
    const hasDestructiveApproval = destructiveApprovalCount > 0;
    const canApply = preflightReport ? isDashboardStructurePreflightReady(preflightReport) : false;
    const hardBlockerCount = preflightReport ? countDashboardStructurePreflightHardBlockers(preflightReport) : 0;
    const confirmationMatches = !hasDestructiveApproval || deleteConfirmation.trim() === expectedDeleteText;

    return (
        <div className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] p-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                    <p className='text-xs font-semibold text-[var(--dash-text)]'>Apply preflight</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Re-checks the approved plan against the current server before it can be queued.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={() => onPreflight(run)}
                    disabled={Boolean(busyAction)}
                    className={dashboardSecondaryActionClassName}>
                    {isPreflightBusy ? 'Checking' : 'Run preflight'}
                </button>
            </div>
            {preflightReport ? <PreflightReport report={preflightReport} /> : null}
            {canApply ? (
                <div className='mt-3 border-t border-[var(--dash-border)] pt-3'>
                    <div className='mt-2 flex justify-end'>
                        <button
                            type='button'
                            onClick={() => onApply(run)}
                            disabled={Boolean(busyAction) || !confirmationMatches}
                            className={dashboardPrimaryActionClassName}>
                            {isApplyBusy ? 'Queueing' : 'Queue deployment'}
                        </button>
                    </div>
                    {hasDestructiveApproval ? (
                        <DashboardStatus tone='danger' role='alert'>
                            <div className='w-full'>
                                <label
                                    className='block text-xs font-semibold text-[var(--dash-text)]'
                                    htmlFor={`delete-approval-${run.id}`}>
                                    Type {expectedDeleteText} to approve {destructiveApprovalCount} irreversible delete
                                    {destructiveApprovalCount === 1 ? '' : 's'}
                                </label>
                                <input
                                    id={`delete-approval-${run.id}`}
                                    value={deleteConfirmation}
                                    onChange={(event) => onDeleteConfirmationChange(run.id, event.currentTarget.value)}
                                    className={`mt-2 ${dashboardFieldClassName} focus:border-[var(--dash-danger)]`}
                                />
                                <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                                    Deletes are irreversible server mutations. Approval is bound to this exact plan and
                                    safety check.
                                </p>
                            </div>
                        </DashboardStatus>
                    ) : null}
                    <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        This executes preflight-ready creates, role name, color, hoist, mentionability, and permission
                        updates, supported channel/category name and permission overwrite updates, and explicitly
                        approved deletes.
                    </p>
                </div>
            ) : preflightReport && hardBlockerCount > 0 ? (
                <DashboardStatus tone='danger' title='Apply blocked' role='alert'>
                    <p>
                        Fix or remove {hardBlockerCount} unsupported, stale, mapping-required, or invalid planned{' '}
                        {hardBlockerCount === 1 ? 'change' : 'changes'}, then create a new deployment plan.
                    </p>
                    {hasDestructiveApproval ? (
                        <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            Delete approval is only available after hard blockers are gone.
                        </p>
                    ) : null}
                </DashboardStatus>
            ) : null}
        </div>
    );
}

function PreflightReport({ report }: { report: DashboardStructurePreflightReport }) {
    const blockers = sortPreflightBlockers(report.actions.filter((action) => action.status !== 'ready'));

    return (
        <div className='mt-3 border-t border-[var(--dash-border)] pt-3' role='status' aria-live='polite'>
            <p className='text-xs text-[var(--dash-text)]'>
                {report.summary.ready} ready, {report.summary.stale} stale, {report.summary.mappingRequired} mapping
                required, {report.summary.destructiveApprovalRequired} destructive approval,{' '}
                {report.summary.unsupported} unsupported, {report.summary.invalidPlan} invalid.
            </p>
            {blockers.length > 0 ? (
                <ul className='mt-2 space-y-1 text-xs text-[var(--dash-text-muted)]'>
                    {blockers.slice(0, 4).map((action) => (
                        <li key={action.actionId}>
                            <span className='font-semibold text-[var(--dash-text)]'>{formatStatus(action.status)}</span>
                            : {action.label ?? action.targetId ?? action.targetType} - {action.message}
                        </li>
                    ))}
                    {blockers.length > 4 ? <li>+{blockers.length - 4} more blockers</li> : null}
                </ul>
            ) : null}
        </div>
    );
}

function sortPreflightBlockers(
    actions: DashboardStructurePreflightReport['actions']
): DashboardStructurePreflightReport['actions'] {
    return [...actions].sort(
        (left, right) => preflightStatusPriority(left.status) - preflightStatusPriority(right.status)
    );
}

function preflightStatusPriority(status: string): number {
    switch (status) {
        case 'unsupported':
        case 'invalid-plan':
        case 'mapping-required':
        case 'stale':
            return 0;
        case 'destructive-approval-required':
            return 1;
        default:
            return 2;
    }
}

function formatStatus(status: string): string {
    return status.replace(/[-_]/gu, ' ');
}
