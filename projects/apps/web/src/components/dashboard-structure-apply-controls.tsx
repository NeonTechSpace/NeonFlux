import {
    countDashboardStructurePreflightHardBlockers,
    isDashboardStructurePreflightReady,
} from '../server/dashboard-structure-preflight.js';
import { useEffect, useState } from 'react';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { getDashboardStructureDeleteApprovalText } from '../server/dashboard-structure-contracts.js';
import {
    dashboardFieldClassName,
    dashboardDangerActionClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
    DashboardStatus,
} from './dashboard-ui.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';

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
    preflightReport: DashboardStructurePreflightView | undefined;
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
    const preflightExpiry = usePreflightExpiry(preflightReport?.expiresAt);
    const preflightExpired = preflightReport?.expiresAt
        ? preflightExpiry.expiresAt !== preflightReport.expiresAt || preflightExpiry.expired
        : false;
    const retryPreflightRequired =
        run.execution?.status === 'failed_before_mutation' &&
        (!preflightReport?.checkedAt || preflightReport.checkedAt <= run.execution.updatedAt);
    const canApply = preflightReport
        ? isDashboardStructurePreflightReady(preflightReport) && !preflightExpired && !retryPreflightRequired
        : false;
    const hardBlockerCount = preflightReport ? countDashboardStructurePreflightHardBlockers(preflightReport) : 0;
    const confirmationMatches = !hasDestructiveApproval || deleteConfirmation.trim() === expectedDeleteText;

    return (
        <div className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] p-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                    <p className='text-xs font-semibold text-[var(--dash-text)]'>Final safety check</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Confirms the reviewed result still matches the live server before application.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={() => onPreflight(run)}
                    disabled={Boolean(busyAction)}
                    className={dashboardSecondaryActionClassName}>
                    {isPreflightBusy
                        ? 'Checking live server'
                        : preflightReport
                          ? 'Refresh safety check'
                          : 'Run safety check'}
                </button>
            </div>
            {preflightReport ? <PreflightReport report={preflightReport} /> : null}
            {canApply ? (
                <div className='mt-3 border-t border-[var(--dash-border)] pt-3'>
                    <p className='mb-3 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        After you apply, NeonFlux saves a restore point before the first server change. If that fails,
                        the deployment stops without mutating Fluxer.
                    </p>
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
                                    These live deletions require an explicit confirmation bound to this reviewed result
                                    and safety check.
                                </p>
                            </div>
                        </DashboardStatus>
                    ) : null}
                    <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Applying starts the durable deployment immediately. Closing this page will not stop it.
                    </p>
                    <div className='mt-3 flex justify-end'>
                        <button
                            type='button'
                            onClick={() => onApply(run)}
                            disabled={Boolean(busyAction) || !confirmationMatches}
                            className={
                                hasDestructiveApproval
                                    ? dashboardDangerActionClassName
                                    : dashboardPrimaryActionClassName
                            }>
                            {isApplyBusy
                                ? 'Starting deployment'
                                : `Apply ${run.actionCount} change${run.actionCount === 1 ? '' : 's'}${hasDestructiveApproval ? `, including ${destructiveApprovalCount} deletion${destructiveApprovalCount === 1 ? '' : 's'}` : ''}`}
                        </button>
                    </div>
                </div>
            ) : retryPreflightRequired ? (
                <DashboardStatus tone='warning' title='Fresh safety check required' role='alert'>
                    Run the safety check again after the failed deployment before applying this reviewed result.
                </DashboardStatus>
            ) : preflightExpired ? (
                <DashboardStatus tone='warning' title='Safety check expired' role='alert'>
                    Run the safety check again before applying this reviewed result.
                </DashboardStatus>
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

function PreflightReport({ report }: { report: DashboardStructurePreflightView }) {
    const blockers = sortPreflightBlockers(report.actions.filter((action) => action.status !== 'ready'));

    return (
        <div className='mt-3 border-t border-[var(--dash-border)] pt-3' role='status' aria-live='polite'>
            <p className='text-xs text-[var(--dash-text)]'>
                {report.summary.ready} ready, {report.summary.stale} stale, {report.summary.mappingRequired} mapping
                required, {report.summary.destructiveApprovalRequired} destructive approval,{' '}
                {report.summary.unsupported} unsupported, {report.summary.invalidPlan} invalid.
            </p>
            {report.checkedAt || report.expiresAt ? (
                <p className='mt-1 text-[11px] text-[var(--dash-text-subtle)]'>
                    {report.checkedAt ? `Checked ${formatPreflightTime(report.checkedAt)}` : 'Safety check complete'}
                    {report.expiresAt ? ` · valid until ${formatPreflightTime(report.expiresAt)}` : ''}
                </p>
            ) : null}
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
    actions: DashboardStructurePreflightView['actions']
): DashboardStructurePreflightView['actions'] {
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

function formatPreflightTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function usePreflightExpiry(expiresAt: string | undefined): { expiresAt: string | undefined; expired: boolean } {
    const [state, setState] = useState<{ expiresAt: string | undefined; expired: boolean }>({
        expiresAt: undefined,
        expired: true,
    });

    useEffect(() => {
        let timeout = window.setTimeout(checkExpiry, 0);

        function checkExpiry(): void {
            if (!expiresAt) {
                setState({ expiresAt: undefined, expired: false });
                return;
            }

            const expiryTime = new Date(expiresAt).getTime();
            const remainingMs = expiryTime - Date.now();
            if (!Number.isFinite(expiryTime) || remainingMs <= 0) {
                setState({ expiresAt, expired: true });
                return;
            }

            setState({ expiresAt, expired: false });
            timeout = window.setTimeout(checkExpiry, remainingMs);
        }

        return () => window.clearTimeout(timeout);
    }, [expiresAt]);

    return state;
}
