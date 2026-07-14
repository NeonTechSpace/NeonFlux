import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
} from '../server/dashboard-structure-model.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatBackupSource, formatDate, formatStatus } from './dashboard-structure-panel-format.js';
import { countPlanChanges } from './dashboard-structure-panel-status.js';
import { emptyPlanSummary } from './dashboard-structure-panel-types.js';
import type { DriftState } from './dashboard-structure-panel-types.js';
import { MiniCount } from './dashboard-structure-panel-shared.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

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
        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Drift check</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Manual live comparison against the latest regular backup or a selected backup row.
                    </p>
                </div>
                <button
                    type='button'
                    onClick={onCheckLatest}
                    disabled={busy}
                    className={dashboardSecondaryActionClassName}>
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
                <p className='mt-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 text-xs leading-5 text-[var(--dash-text-subtle)]'>
                    Scheduled drift monitoring is queued with automatic backups.
                    {settings.nextDriftCheckAt ? ` Next check: ${formatDate(settings.nextDriftCheckAt)}.` : ''}
                </p>
            ) : null}

            {drift ? (
                <div className='mt-4 space-y-4'>
                    <div className='flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dash-border)] pt-3'>
                        <div>
                            <p className='text-sm font-semibold text-[var(--dash-text)]'>
                                {driftCount === 0
                                    ? `Live server matches ${drift.baseline.name}.`
                                    : `${driftCount} drift changes found`}
                            </p>
                            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-subtle)]'>
                                Baseline: {drift.baseline.name} · {formatBackupSource(drift.baseline.source)} ·{' '}
                                {formatDate(drift.baseline.completedAt)}
                            </p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                onClick={onCreateBackup}
                                disabled={busy}
                                className={`${dashboardSecondaryActionClassName} text-xs`}>
                                Create backup now
                            </button>
                            <button
                                type='button'
                                onClick={() => onCreateDryRun(drift.baseline)}
                                disabled={busy || drift.baseline.status !== 'succeeded'}
                                className={`${dashboardPrimaryActionClassName} min-h-9 px-3 text-xs`}>
                                Plan restore to this baseline
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
                        <div className='max-h-[min(14rem,42dvh)] overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)]'>
                            {drift.previewActions.map((action) => (
                                <button
                                    type='button'
                                    key={action.id}
                                    onClick={() => onSelectAction(action)}
                                    className='grid w-full gap-2 border-b border-[var(--dash-border)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--dash-primary-soft)] focus-visible:bg-[var(--dash-primary-soft)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none md:grid-cols-[5rem_7rem_minmax(0,1fr)_minmax(8rem,0.7fr)]'>
                                    <span className='text-xs font-semibold text-[var(--dash-text)]'>
                                        {formatStatus(action.actionType)}
                                    </span>
                                    <span className='text-xs text-[var(--dash-text-subtle)]'>
                                        {formatStatus(action.targetType)}
                                    </span>
                                    <span className='truncate text-xs text-[var(--dash-text)]'>
                                        {action.label ?? action.targetId ?? 'Unknown target'}
                                    </span>
                                    <span className='truncate text-xs text-[var(--dash-text-subtle)]'>
                                        {action.fields.length > 0 ? action.fields.map(formatStatus).join(', ') : 'item'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {drift.hasMorePreview ? (
                        <p className='text-xs leading-5 text-[var(--dash-text-subtle)]'>
                            Preview is capped. Use this baseline as a deployment source to review every action.
                        </p>
                    ) : null}
                    <p className='text-xs leading-5 text-[var(--dash-text-subtle)]'>
                        Checked {formatDate(drift.checkedAt)}. Live counts: {drift.liveCounts.roles} roles,{' '}
                        {drift.liveCounts.categories} categories, {drift.liveCounts.channels} channels.
                    </p>
                </div>
            ) : (
                <p className='mt-3 border-t border-[var(--dash-border)] pt-3 text-xs leading-5 text-[var(--dash-text-subtle)]'>
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
            className={`mt-3 rounded-[var(--dash-radius-control)] border px-3 py-2 ${
                status.tone === 'error'
                    ? 'border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)]'
                    : status.tone === 'warning'
                      ? 'border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)]'
                      : 'border-[var(--dash-border)] bg-[var(--dash-bg)]'
            }`}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p
                        className={`text-sm font-semibold ${
                            status.tone === 'error'
                                ? 'text-[var(--dash-danger)]'
                                : status.tone === 'warning'
                                  ? 'text-[var(--dash-warning)]'
                                  : 'text-[var(--dash-text)]'
                        }`}>
                        {status.title}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>{status.detail}</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-subtle)]'>
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
                        className={`${dashboardSecondaryActionClassName} text-xs`}>
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
