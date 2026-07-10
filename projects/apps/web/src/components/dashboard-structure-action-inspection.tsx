import type { DashboardStructureImportAction } from '../server/dashboard-structure.server.js';

export function DashboardStructureActionInspector({
    action,
    onClose,
}: {
    action: DashboardStructureImportAction;
    onClose: () => void;
}) {
    return (
        <aside
            className='mt-3 rounded-md border border-sky-400/30 bg-sky-950/20 p-3'
            aria-label={`Action details: ${action.label ?? action.targetId ?? action.id}`}>
            <div className='flex items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-sky-100'>
                        {action.actionType} {action.targetType}
                    </p>
                    <p className='mt-1 text-xs text-neutral-300'>
                        {action.label ?? action.targetId ?? 'Unnamed target'}
                    </p>
                </div>
                <button
                    type='button'
                    onClick={onClose}
                    className='rounded border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-200'>
                    Close
                </button>
            </div>
            <dl className='mt-3 grid gap-2 text-xs sm:grid-cols-2'>
                <div>
                    <dt className='text-neutral-500'>Sequence</dt>
                    <dd className='font-mono text-neutral-200'>{action.sequence}</dd>
                </div>
                <div>
                    <dt className='text-neutral-500'>Target ID</dt>
                    <dd className='font-mono break-all text-neutral-200'>
                        {action.targetId ?? 'Created during apply'}
                    </dd>
                </div>
            </dl>
            <details className='mt-3 border-t border-neutral-800 pt-3'>
                <summary className='cursor-pointer text-xs font-semibold text-neutral-300'>Action payload</summary>
                <pre className='mt-2 max-h-64 overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap text-neutral-400'>
                    {JSON.stringify(action.details, null, 2)}
                </pre>
            </details>
        </aside>
    );
}

export function DashboardStructureActionPreview({
    actions,
    actionCount,
    isLoading,
    onLoad,
    onInspectAction,
}: {
    actions: DashboardStructureImportAction[];
    actionCount: number;
    isLoading: boolean;
    onLoad: () => void;
    onInspectAction: (action: DashboardStructureImportAction) => void;
}) {
    if (actions.length === 0 && actionCount > 0) {
        return (
            <div className='mt-3 flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-3'>
                <p className='text-xs text-neutral-400'>Actions are loaded on demand.</p>
                <button
                    type='button'
                    onClick={onLoad}
                    disabled={isLoading}
                    className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    {isLoading ? 'Loading' : 'Load actions'}
                </button>
            </div>
        );
    }

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
                    <button
                        type='button'
                        onClick={() => onInspectAction(action)}
                        className='shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                        Inspect
                    </button>
                </li>
            ))}
            {actionCount > actions.length ? (
                <li className='flex items-center justify-between gap-3 py-2'>
                    <span className='text-xs text-neutral-500'>+{actionCount - actions.length} more</span>
                    <button
                        type='button'
                        onClick={onLoad}
                        disabled={isLoading}
                        className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {isLoading ? 'Loading' : 'Load more'}
                    </button>
                </li>
            ) : null}
        </ul>
    );
}

function formatActionMapping(action: DashboardStructureImportAction): string | undefined {
    const sourceId = typeof action.details.sourceId === 'string' ? action.details.sourceId : undefined;
    const createdId = typeof action.details.createdId === 'string' ? action.details.createdId : undefined;

    return sourceId && createdId ? `${sourceId} -> ${createdId}` : undefined;
}
