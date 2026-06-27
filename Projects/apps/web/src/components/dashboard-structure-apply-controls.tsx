import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';

export function DashboardStructureApplyControls({
    run,
    busyAction,
    preflightReport,
    applyConfirmation,
    deleteConfirmation,
    onPreflight,
    onApplyConfirmationChange,
    onDeleteConfirmationChange,
    onApply,
}: {
    run: DashboardStructureImportRun;
    busyAction: string | undefined;
    preflightReport: DashboardStructurePreflightReport | undefined;
    applyConfirmation: string;
    deleteConfirmation: string;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onApplyConfirmationChange: (runId: string, confirmation: string) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onApply: (run: DashboardStructureImportRun) => void;
}) {
    const expectedApplyText = `APPLY ${run.id}`;
    const destructiveApprovalCount = preflightReport?.summary.destructiveApprovalRequired ?? 0;
    const expectedDeleteText = `DELETE ${run.id} ${destructiveApprovalCount}`;
    const isPreflightBusy = busyAction === `preflight:${run.id}`;
    const isApplyBusy = busyAction === `apply:${run.id}`;
    const hasDestructiveApproval = destructiveApprovalCount > 0;
    const canApply = preflightReport ? isApprovablePreflightReport(preflightReport) : false;
    const confirmationMatches =
        applyConfirmation.trim() === expectedApplyText &&
        (!hasDestructiveApproval || deleteConfirmation.trim() === expectedDeleteText);

    return (
        <div className='mt-3 rounded-md border border-sky-400/30 bg-sky-950/20 p-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                    <p className='text-xs font-semibold text-sky-100'>Apply preflight</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Re-checks the confirmed dry-run against the current server before any apply attempt.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={() => onPreflight(run)}
                    disabled={Boolean(busyAction)}
                    className='min-h-10 rounded-md bg-sky-300 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                    {isPreflightBusy ? 'Checking' : 'Run preflight'}
                </button>
            </div>
            {preflightReport ? <PreflightReport report={preflightReport} /> : null}
            {canApply ? (
                <div className='mt-3 border-t border-sky-400/20 pt-3'>
                    <label className='block text-xs font-semibold text-sky-100' htmlFor={`apply-${run.id}`}>
                        Type {expectedApplyText} to apply ready updates
                    </label>
                    <div className='mt-2 flex flex-col gap-2 sm:flex-row'>
                        <input
                            id={`apply-${run.id}`}
                            value={applyConfirmation}
                            onChange={(event) => onApplyConfirmationChange(run.id, event.currentTarget.value)}
                            className='min-h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-300/30'
                        />
                        <button
                            type='button'
                            onClick={() => onApply(run)}
                            disabled={Boolean(busyAction) || !confirmationMatches}
                            className='min-h-10 rounded-md bg-emerald-300 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                            {isApplyBusy ? 'Applying' : 'Apply'}
                        </button>
                    </div>
                    {hasDestructiveApproval ? (
                        <div className='mt-3 rounded-md border border-rose-400/30 bg-rose-950/20 p-3'>
                            <label
                                className='block text-xs font-semibold text-rose-100'
                                htmlFor={`delete-approval-${run.id}`}>
                                Type {expectedDeleteText} to approve {destructiveApprovalCount} delete
                                {destructiveApprovalCount === 1 ? '' : 's'}
                            </label>
                            <input
                                id={`delete-approval-${run.id}`}
                                value={deleteConfirmation}
                                onChange={(event) => onDeleteConfirmationChange(run.id, event.currentTarget.value)}
                                className='mt-2 min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/30'
                            />
                            <p className='mt-2 text-xs leading-5 text-neutral-400'>
                                Deletes are irreversible server mutations. NeonFlux re-checks the dry-run immediately
                                before applying them.
                            </p>
                        </div>
                    ) : null}
                    <p className='mt-2 text-xs leading-5 text-neutral-400'>
                        This executes preflight-ready creates, role visual updates, supported channel/category name and
                        permission overwrite updates, and explicitly approved deletes.
                    </p>
                </div>
            ) : null}
        </div>
    );
}

function PreflightReport({ report }: { report: DashboardStructurePreflightReport }) {
    const blockers = report.actions.filter((action) => action.status !== 'ready');

    return (
        <div className='mt-3 border-t border-sky-400/20 pt-3'>
            <p className='text-xs text-neutral-300'>
                {report.summary.ready} ready, {report.summary.stale} stale, {report.summary.mappingRequired} mapping
                required, {report.summary.destructiveApprovalRequired} destructive approval,{' '}
                {report.summary.unsupported} unsupported, {report.summary.invalidPlan} invalid.
            </p>
            {blockers.length > 0 ? (
                <ul className='mt-2 space-y-1 text-xs text-neutral-400'>
                    {blockers.slice(0, 4).map((action) => (
                        <li key={action.actionId}>
                            <span className='font-semibold text-neutral-200'>{formatStatus(action.status)}</span>:{' '}
                            {action.label ?? action.targetId ?? action.targetType} - {action.message}
                        </li>
                    ))}
                    {blockers.length > 4 ? <li>+{blockers.length - 4} more blockers</li> : null}
                </ul>
            ) : null}
        </div>
    );
}

function formatStatus(status: string): string {
    return status.replaceAll('_', ' ');
}

function isApprovablePreflightReport(report: DashboardStructurePreflightReport): boolean {
    const hardBlockers =
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan;

    return (
        hardBlockers === 0 && report.summary.ready + report.summary.destructiveApprovalRequired === report.summary.total
    );
}
