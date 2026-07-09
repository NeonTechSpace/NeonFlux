import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
} from '../server/dashboard-structure.server.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatBackupSource, formatDate, formatStatus } from './dashboard-structure-panel-format.js';
import { countPlanChanges } from './dashboard-structure-panel-status.js';
import { emptyPlanSummary } from './dashboard-structure-panel-types.js';
import type { DriftState } from './dashboard-structure-panel-types.js';
import { MiniCount } from './dashboard-structure-panel-shared.js';

export function DashboardStructureDriftPanel({
    drift,
    settings,
    busyAction,
    onCheckLatest,
    onCreateBackup,
    onCreateDryRun,
    onReviewScheduledDrift,
    onSelectAction,
}: {
    drift: DriftState | undefined;
    settings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    onCheckLatest: () => void;
    onCreateBackup: () => void;
    onCreateDryRun: (backup: DashboardStructureBackupSummary) => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
    onSelectAction: (action: DriftState['previewActions'][number]) => void;
}) {
    const driftCount = drift ? countPlanChanges(drift.summary) : 0;
    const isChecking = busyAction === 'drift';
    const busy = Boolean(busyAction);
    const scheduledDrift = settings.scheduledDrift;

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Drift check</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Manual live comparison against the latest regular backup or a selected backup row.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={onCheckLatest}
                    disabled={busy}
                    className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    {isChecking ? 'Checking' : 'Check latest'}
                </button>
            </div>

            {scheduledDrift ? (
                <ScheduledDriftStatus
                    busy={busy}
                    isReviewing={isChecking}
                    scheduledDrift={scheduledDrift}
                    onReviewScheduledDrift={onReviewScheduledDrift}
                />
            ) : settings.enabled ? (
                <p className='mt-3 rounded-md border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs leading-5 text-neutral-500'>
                    Scheduled drift monitoring is queued with automatic backups.
                    {settings.nextDriftCheckAt ? ` Next check: ${formatDate(settings.nextDriftCheckAt)}.` : ''}
                </p>
            ) : null}

            {drift ? (
                <div className='mt-4 space-y-4'>
                    <div className='flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-3'>
                        <div>
                            <p className='text-sm font-semibold text-white'>
                                {driftCount === 0
                                    ? `Live server matches ${drift.baseline.name}.`
                                    : `${driftCount} drift changes found`}
                            </p>
                            <p className='mt-1 text-xs leading-5 text-neutral-500'>
                                Baseline: {drift.baseline.name} · {formatBackupSource(drift.baseline.source)} ·{' '}
                                {formatDate(drift.baseline.completedAt)}
                            </p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                onClick={onCreateBackup}
                                disabled={busy}
                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                Create backup now
                            </button>
                            <button
                                type='button'
                                onClick={() => onCreateDryRun(drift.baseline)}
                                disabled={busy || drift.baseline.status !== 'succeeded'}
                                className='min-h-9 rounded-md bg-sky-400 px-3 text-xs font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                Create dry-run from baseline
                            </button>
                        </div>
                    </div>

                    <div className='grid grid-cols-3 gap-2 text-center md:grid-cols-6'>
                        <MiniCount label='Creates' value={drift.summary.creates} />
                        <MiniCount label='Updates' value={drift.summary.updates} />
                        <MiniCount label='Deletes' value={drift.summary.deletes} />
                        <MiniCount label='Roles' value={drift.summary.roles} />
                        <MiniCount label='Categories' value={drift.summary.categories} />
                        <MiniCount label='Channels' value={drift.summary.channels} />
                    </div>

                    <div className='grid grid-cols-2 gap-2 text-center md:grid-cols-3'>
                        <MiniCount label='Names' value={drift.fieldSummary.names} />
                        <MiniCount label='Permissions' value={drift.fieldSummary.permissions} />
                        <MiniCount label='Positions' value={drift.fieldSummary.positions} />
                        <MiniCount label='Parents' value={drift.fieldSummary.parentMoves} />
                        <MiniCount label='Types' value={drift.fieldSummary.typeChanges} />
                        <MiniCount label='Role visuals' value={drift.fieldSummary.roleVisuals} />
                    </div>

                    {drift.previewActions.length > 0 ? (
                        <div className='max-h-56 overflow-y-auto rounded-md border border-neutral-800'>
                            {drift.previewActions.map((action) => (
                                <button
                                    type='button'
                                    key={action.id}
                                    onClick={() => onSelectAction(action)}
                                    className='grid gap-2 border-b border-neutral-800 px-3 py-2 text-left last:border-b-0 md:grid-cols-[5rem_7rem_minmax(0,1fr)_minmax(8rem,0.7fr)]'>
                                    <span className='text-xs font-semibold text-neutral-300'>
                                        {formatStatus(action.actionType)}
                                    </span>
                                    <span className='text-xs text-neutral-500'>{formatStatus(action.targetType)}</span>
                                    <span className='truncate text-xs text-neutral-200'>
                                        {action.label ?? action.targetId ?? 'Unknown target'}
                                    </span>
                                    <span className='truncate text-xs text-neutral-500'>
                                        {action.fields.length > 0 ? action.fields.map(formatStatus).join(', ') : 'item'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {drift.hasMorePreview ? (
                        <p className='text-xs leading-5 text-neutral-500'>
                            Preview is capped. Create a dry-run from the baseline to review every action.
                        </p>
                    ) : null}
                    <p className='text-xs leading-5 text-neutral-500'>
                        Checked {formatDate(drift.checkedAt)}. Live counts: {drift.liveCounts.roles} roles,{' '}
                        {drift.liveCounts.categories} categories, {drift.liveCounts.channels} channels.
                    </p>
                </div>
            ) : (
                <p className='mt-3 border-t border-neutral-800 pt-3 text-xs leading-5 text-neutral-500'>
                    No drift check has been run in this view.
                </p>
            )}
        </div>
    );
}

function ScheduledDriftStatus({
    busy,
    isReviewing,
    scheduledDrift,
    onReviewScheduledDrift,
}: {
    busy: boolean;
    isReviewing: boolean;
    scheduledDrift: NonNullable<DashboardStructureBackupSettings['scheduledDrift']>;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
}) {
    const status = readScheduledDriftCopy(scheduledDrift);
    const canReview = scheduledDrift.status === 'changed' && Boolean(scheduledDrift.baselineBackupId);

    return (
        <div
            className={`mt-3 rounded-md border px-3 py-2 ${
                status.tone === 'error'
                    ? 'border-rose-400/25 bg-rose-400/10'
                    : status.tone === 'warning'
                      ? 'border-amber-400/25 bg-amber-400/10'
                      : 'border-neutral-800 bg-neutral-950/70'
            }`}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p
                        className={`text-sm font-semibold ${
                            status.tone === 'error'
                                ? 'text-rose-100'
                                : status.tone === 'warning'
                                  ? 'text-amber-100'
                                  : 'text-neutral-100'
                        }`}>
                        {status.title}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>{status.detail}</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-500'>
                        {scheduledDrift.checkedAt
                            ? `Checked ${formatDate(scheduledDrift.checkedAt)}.`
                            : 'Not checked yet.'}
                        {scheduledDrift.nextCheckAt ? ` Next: ${formatDate(scheduledDrift.nextCheckAt)}.` : ''}
                    </p>
                </div>
                {canReview ? (
                    <button
                        type='button'
                        onClick={() => onReviewScheduledDrift(scheduledDrift.baselineBackupId ?? '')}
                        disabled={busy}
                        className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {isReviewing ? 'Reviewing' : 'Review drift'}
                    </button>
                ) : null}
            </div>
            {scheduledDrift.summary ? (
                <div className='mt-3 grid grid-cols-3 gap-2 text-center md:grid-cols-6'>
                    <MiniCount label='Creates' value={scheduledDrift.summary.creates} />
                    <MiniCount label='Updates' value={scheduledDrift.summary.updates} />
                    <MiniCount label='Deletes' value={scheduledDrift.summary.deletes} />
                    <MiniCount label='Roles' value={scheduledDrift.summary.roles} />
                    <MiniCount label='Categories' value={scheduledDrift.summary.categories} />
                    <MiniCount label='Channels' value={scheduledDrift.summary.channels} />
                </div>
            ) : null}
        </div>
    );
}

function readScheduledDriftCopy(scheduledDrift: NonNullable<DashboardStructureBackupSettings['scheduledDrift']>): {
    detail: string;
    title: string;
    tone: 'error' | 'neutral' | 'warning';
} {
    if (scheduledDrift.status === 'changed') {
        const count = scheduledDrift.changeCount ?? countPlanChanges(scheduledDrift.summary ?? emptyPlanSummary);

        return {
            detail: `Baseline: ${scheduledDrift.baselineName ?? scheduledDrift.baselineBackupId ?? 'latest backup'}.`,
            title: `Scheduled drift found ${count} change${count === 1 ? '' : 's'}.`,
            tone: 'warning',
        };
    }

    if (scheduledDrift.status === 'failed') {
        return {
            detail: scheduledDrift.errorMessage ?? 'The scheduled drift check failed.',
            title: 'Scheduled drift check failed.',
            tone: 'error',
        };
    }

    if (scheduledDrift.status === 'no_baseline') {
        return {
            detail: 'Create or wait for a successful regular backup before scheduled drift can compare layouts.',
            title: 'Scheduled drift needs a baseline.',
            tone: 'warning',
        };
    }

    if (scheduledDrift.status === 'clean') {
        return {
            detail: scheduledDrift.baselineName
                ? `Live server matched ${scheduledDrift.baselineName}.`
                : 'Live server matched the latest regular backup.',
            title: 'No scheduled drift found.',
            tone: 'neutral',
        };
    }

    return {
        detail: 'Scheduled drift monitoring is queued with automatic backups.',
        title: 'Scheduled drift pending.',
        tone: 'neutral',
    };
}
