import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import { DashboardStructureApplyControls } from './dashboard-structure-apply-controls.js';

export type StructureBusyAction =
    | 'export'
    | 'dry-run'
    | `confirm:${string}`
    | `preflight:${string}`
    | `apply:${string}`;

export function DashboardStructureImportHistory({
    runs,
    latestRun,
    busyAction,
    confirmationByRunId,
    preflightByRunId,
    applyConfirmationByRunId,
    deleteConfirmationByRunId,
    onConfirmationChange,
    onApplyConfirmationChange,
    onDeleteConfirmationChange,
    onConfirm,
    onPreflight,
    onApply,
}: {
    runs: DashboardStructureImportRun[];
    latestRun: DashboardStructureImportRun | undefined;
    busyAction: StructureBusyAction | undefined;
    confirmationByRunId: Record<string, string>;
    preflightByRunId: Record<string, DashboardStructurePreflightReport>;
    applyConfirmationByRunId: Record<string, string>;
    deleteConfirmationByRunId: Record<string, string>;
    onConfirmationChange: (runId: string, confirmation: string) => void;
    onApplyConfirmationChange: (runId: string, confirmation: string) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onConfirm: (run: DashboardStructureImportRun) => void;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onApply: (run: DashboardStructureImportRun) => void;
}) {
    if (runs.length === 0) {
        return <p className='text-sm leading-6 text-neutral-400'>No import dry-runs yet.</p>;
    }

    return (
        <div className='space-y-3'>
            {runs.map((run) => (
                <ImportRunCard
                    key={run.id}
                    run={run}
                    isLatest={latestRun?.id === run.id}
                    busyAction={busyAction}
                    confirmation={confirmationByRunId[run.id] ?? ''}
                    preflightReport={preflightByRunId[run.id]}
                    applyConfirmation={applyConfirmationByRunId[run.id] ?? ''}
                    deleteConfirmation={deleteConfirmationByRunId[run.id] ?? ''}
                    onConfirmationChange={onConfirmationChange}
                    onApplyConfirmationChange={onApplyConfirmationChange}
                    onDeleteConfirmationChange={onDeleteConfirmationChange}
                    onConfirm={onConfirm}
                    onPreflight={onPreflight}
                    onApply={onApply}
                />
            ))}
        </div>
    );
}

function ImportRunCard({
    run,
    isLatest,
    busyAction,
    confirmation,
    preflightReport,
    applyConfirmation,
    deleteConfirmation,
    onConfirmationChange,
    onApplyConfirmationChange,
    onDeleteConfirmationChange,
    onConfirm,
    onPreflight,
    onApply,
}: {
    run: DashboardStructureImportRun;
    isLatest: boolean;
    busyAction: StructureBusyAction | undefined;
    confirmation: string;
    preflightReport: DashboardStructurePreflightReport | undefined;
    applyConfirmation: string;
    deleteConfirmation: string;
    onConfirmationChange: (runId: string, confirmation: string) => void;
    onApplyConfirmationChange: (runId: string, confirmation: string) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onConfirm: (run: DashboardStructureImportRun) => void;
    onPreflight: (run: DashboardStructureImportRun) => void;
    onApply: (run: DashboardStructureImportRun) => void;
}) {
    const expectedText = `CONFIRM ${run.id}`;
    const isConfirmBusy = busyAction === `confirm:${run.id}`;
    const canConfirm = run.status === 'dry_run_complete';
    const canPreflight = run.status === 'confirmed';

    return (
        <div
            className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'
            aria-current={isLatest ? 'true' : undefined}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Dry-run {formatDate(run.createdAt)}</p>
                    <p className='mt-1 text-xs text-neutral-500'>{formatStatus(run.status)}</p>
                </div>
                <p className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-300'>
                    {run.actions.length} changes
                </p>
            </div>
            <p className='mt-3 text-sm text-neutral-300'>
                {run.summary.creates} create, {run.summary.updates} update, {run.summary.deletes} delete
            </p>
            <ActionPreview actions={run.actions} />
            {canConfirm ? (
                <div className='mt-3 rounded-md border border-amber-400/30 bg-amber-950/20 p-3'>
                    <label className='block text-xs font-semibold text-amber-100' htmlFor={`confirm-${run.id}`}>
                        Type {expectedText} to confirm review
                    </label>
                    <div className='mt-2 flex flex-col gap-2 sm:flex-row'>
                        <input
                            id={`confirm-${run.id}`}
                            value={confirmation}
                            onChange={(event) => onConfirmationChange(run.id, event.currentTarget.value)}
                            className='min-h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30'
                        />
                        <button
                            type='button'
                            onClick={() => onConfirm(run)}
                            disabled={Boolean(busyAction) || confirmation.trim() !== expectedText}
                            className='min-h-10 rounded-md bg-amber-300 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                            {isConfirmBusy ? 'Confirming' : 'Confirm'}
                        </button>
                    </div>
                    <p className='mt-2 text-xs leading-5 text-neutral-400'>
                        Confirmation records approval only. No server changes are applied yet.
                    </p>
                </div>
            ) : null}
            {canPreflight ? (
                <DashboardStructureApplyControls
                    run={run}
                    busyAction={busyAction}
                    preflightReport={preflightReport}
                    applyConfirmation={applyConfirmation}
                    deleteConfirmation={deleteConfirmation}
                    onPreflight={onPreflight}
                    onApplyConfirmationChange={onApplyConfirmationChange}
                    onDeleteConfirmationChange={onDeleteConfirmationChange}
                    onApply={onApply}
                />
            ) : null}
        </div>
    );
}

function ActionPreview({ actions }: { actions: DashboardStructureImportAction[] }) {
    if (actions.length === 0) {
        return <p className='mt-2 text-xs text-neutral-500'>No structural changes detected.</p>;
    }

    return (
        <ul className='mt-3 divide-y divide-neutral-800 text-sm'>
            {actions.slice(0, 6).map((action) => (
                <li key={action.id} className='flex items-start justify-between gap-3 py-2'>
                    <span className='min-w-0 text-neutral-300'>
                        <span>
                            <span className='font-semibold text-neutral-100'>{action.actionType}</span>{' '}
                            {action.targetType} {action.label ?? action.targetId ?? 'unknown'}
                        </span>
                        {formatActionMapping(action) ? (
                            <span className='mt-1 block font-mono text-xs text-neutral-500'>
                                {formatActionMapping(action)}
                            </span>
                        ) : null}
                    </span>
                    <span className='shrink-0 text-xs text-neutral-500'>{action.status.replaceAll('_', ' ')}</span>
                </li>
            ))}
            {actions.length > 6 ? <li className='py-2 text-xs text-neutral-500'>+{actions.length - 6} more</li> : null}
        </ul>
    );
}

function formatActionMapping(action: DashboardStructureImportAction): string | undefined {
    const sourceId = typeof action.details.sourceId === 'string' ? action.details.sourceId : undefined;
    const createdId = typeof action.details.createdId === 'string' ? action.details.createdId : undefined;

    return sourceId && createdId ? `${sourceId} -> ${createdId}` : undefined;
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
