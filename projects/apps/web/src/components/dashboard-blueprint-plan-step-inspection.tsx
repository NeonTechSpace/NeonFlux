import type { DashboardBlueprintPlanStep } from '../server/dashboard-blueprint-model.js';
import { dashboardQuietActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export function DashboardBlueprintPlanStepInspector({
    action,
    onClose,
}: {
    action: DashboardBlueprintPlanStep;
    onClose: () => void;
}) {
    return (
        <aside
            className='mt-3 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] p-3'
            aria-label={`Plan step details: ${action.label ?? action.targetId ?? action.id}`}>
            <div className='flex items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>
                        {action.actionType} {action.targetType}
                    </p>
                    <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                        {action.label ?? action.targetId ?? 'Unnamed target'}
                    </p>
                </div>
                <button
                    type='button'
                    onClick={onClose}
                    className={`${dashboardQuietActionClassName} min-h-8 px-2 text-xs`}>
                    Close
                </button>
            </div>
            <dl className='mt-3 grid gap-2 text-xs sm:grid-cols-2'>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Sequence</dt>
                    <dd className='font-mono text-[var(--dash-text)]'>{action.sequence}</dd>
                </div>
                <div>
                    <dt className='text-[var(--dash-text-subtle)]'>Target ID</dt>
                    <dd className='font-mono break-all text-[var(--dash-text)]'>
                        {action.targetId ?? 'Created during apply'}
                    </dd>
                </div>
            </dl>
            <details className='mt-3 border-t border-[var(--dash-border)] pt-3'>
                <summary className='cursor-pointer rounded-sm text-xs font-semibold text-[var(--dash-text-muted)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    Plan step payload
                </summary>
                <pre className='mt-2 max-h-[min(16rem,45dvh)] overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap text-[var(--dash-text-muted)]'>
                    {JSON.stringify(action.details, null, 2)}
                </pre>
            </details>
        </aside>
    );
}

export function DashboardBlueprintPlanStepPreview({
    actions,
    changeCount,
    isLoading,
    onLoad,
    onInspectPlanStep,
}: {
    actions: DashboardBlueprintPlanStep[];
    changeCount: number;
    isLoading: boolean;
    onLoad: () => void;
    onInspectPlanStep: (action: DashboardBlueprintPlanStep) => void;
}) {
    if (actions.length === 0 && changeCount > 0) {
        return (
            <div className='mt-3 flex items-center justify-between gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-3'>
                <p className='text-xs text-[var(--dash-text-muted)]'>Plan steps are loaded on demand.</p>
                <button
                    type='button'
                    onClick={onLoad}
                    disabled={isLoading}
                    className={`${dashboardSecondaryActionClassName} text-xs`}>
                    {isLoading ? 'Loading' : 'Load plan steps'}
                </button>
            </div>
        );
    }

    if (actions.length === 0) {
        return <p className='mt-2 text-xs text-[var(--dash-text-subtle)]'>No structural changes detected.</p>;
    }

    return (
        <ul className='mt-3 divide-y divide-[var(--dash-border)] text-sm'>
            {actions.slice(0, 6).map((action) => (
                <li key={action.id} className='flex items-start justify-between gap-3 py-2'>
                    <span className='min-w-0 text-[var(--dash-text-muted)]'>
                        <span>
                            <span className='font-semibold text-[var(--dash-text)]'>{action.actionType}</span>{' '}
                            {action.targetType} {action.label ?? action.targetId ?? 'unknown'}
                        </span>
                        {formatPlanStepMapping(action) ? (
                            <span className='mt-1 block font-mono text-xs text-[var(--dash-text-subtle)]'>
                                {formatPlanStepMapping(action)}
                            </span>
                        ) : null}
                    </span>
                    <button
                        type='button'
                        onClick={() => onInspectPlanStep(action)}
                        className={`${dashboardQuietActionClassName} min-h-8 shrink-0 px-2 text-xs`}>
                        Inspect
                    </button>
                </li>
            ))}
            {changeCount > actions.length ? (
                <li className='flex items-center justify-between gap-3 py-2'>
                    <span className='text-xs text-[var(--dash-text-subtle)]'>+{changeCount - actions.length} more</span>
                    <button
                        type='button'
                        onClick={onLoad}
                        disabled={isLoading}
                        className={`${dashboardQuietActionClassName} min-h-8 px-2 text-xs`}>
                        {isLoading ? 'Loading' : 'Load more'}
                    </button>
                </li>
            ) : null}
        </ul>
    );
}

function formatPlanStepMapping(action: DashboardBlueprintPlanStep): string | undefined {
    const sourceId = typeof action.details.sourceId === 'string' ? action.details.sourceId : undefined;
    const createdId = typeof action.details.createdId === 'string' ? action.details.createdId : undefined;

    return sourceId && createdId ? `${sourceId} -> ${createdId}` : undefined;
}
