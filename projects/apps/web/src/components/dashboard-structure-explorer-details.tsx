import type { DashboardStructureExplorerSource } from './dashboard-structure-explorer.js';
import type {
    DashboardStructureExplorerAction,
    DashboardStructureExplorerPathMetadata,
} from './dashboard-structure-explorer-model.js';

export function DashboardStructureExplorerDetails({
    metadata,
    source,
}: {
    metadata: DashboardStructureExplorerPathMetadata | undefined;
    source: DashboardStructureExplorerSource;
}) {
    if (!metadata) {
        return (
            <aside className='p-4' aria-label='Blueprint inspector'>
                <p className='text-sm font-semibold text-white'>Select an item</p>
                <p className='mt-1 max-w-md text-xs leading-5 text-neutral-400'>
                    Choose a role, category, channel, or planned action to inspect details.
                </p>
            </aside>
        );
    }

    return (
        <aside className='min-w-0 p-4' aria-label='Blueprint inspector'>
            <header className='border-b border-neutral-800 pb-3'>
                <div className='flex min-w-0 items-baseline gap-2'>
                    <h5 className='min-w-0 truncate text-base font-semibold text-white'>{metadata.label}</h5>
                    <span className='shrink-0 text-xs text-neutral-500'>{formatStatus(metadata.kind)}</span>
                </div>
                <p className='mt-1 truncate text-xs text-neutral-500'>{source.label}</p>
            </header>

            <dl className='mt-1 divide-y divide-neutral-800'>
                {metadata.id ? <DetailValue label='ID' value={metadata.id} /> : null}
                {metadata.entityKey ? <DetailValue label='Entity key' value={metadata.entityKey} /> : null}
                {metadata.parentId ? <DetailValue label='Parent' value={metadata.parentId} /> : null}
                {metadata.position !== undefined && metadata.position !== null ? (
                    <DetailValue label='Position' value={String(metadata.position)} />
                ) : null}
                {metadata.kind === 'channel' || metadata.kind === 'category' ? (
                    <DetailValue
                        label='Channel type'
                        value={String(readItemValue(metadata.item, 'type') ?? 'unknown')}
                    />
                ) : null}
                {metadata.kind === 'role' ? (
                    <>
                        <DetailValue
                            label='Permissions'
                            value={String(readItemValue(metadata.item, 'permissions') ?? 'unknown')}
                        />
                        <DetailValue label='Hoist' value={String(readItemValue(metadata.item, 'hoist') ?? false)} />
                        <DetailValue
                            label='Mentionable'
                            value={String(readItemValue(metadata.item, 'mentionable') ?? false)}
                        />
                    </>
                ) : null}
            </dl>

            {metadata.badges.length > 0 ? (
                <section className='border-t border-neutral-800 py-3' aria-label='Change markers'>
                    <p className='text-xs font-medium text-neutral-500'>Change markers</p>
                    <div className='mt-2 flex flex-wrap gap-x-4 gap-y-2'>
                        {metadata.badges.map((badge) => (
                            <span
                                key={badge}
                                className={`inline-flex items-center gap-1.5 text-xs ${badgeClassName(badge)}`}>
                                <span className='size-1.5 rounded-full bg-current' aria-hidden='true' />
                                {formatStatus(badge)}
                            </span>
                        ))}
                    </div>
                </section>
            ) : null}

            {metadata.risks.length > 0 ? (
                <section className='border-l-2 border-amber-400/60 bg-amber-400/5 px-3 py-2.5' aria-label='Risks'>
                    <p className='text-xs font-semibold text-amber-100'>Needs attention</p>
                    <ul className='mt-1.5 space-y-1 text-xs leading-5 text-neutral-200'>
                        {metadata.risks.map((risk) => (
                            <li key={risk}>{risk}</li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {metadata.actions.length > 0 ? (
                <section className='mt-4 border-t border-neutral-800 pt-3'>
                    <p className='text-xs font-medium text-neutral-500'>Related actions</p>
                    <div className='mt-1 divide-y divide-neutral-800'>
                        {metadata.actions.map((action) => (
                            <ActionDetails key={action.id} action={action} />
                        ))}
                    </div>
                </section>
            ) : null}
        </aside>
    );
}

function ActionDetails({ action }: { action: DashboardStructureExplorerAction }) {
    const changes = readActionChanges(action);

    return (
        <article className='py-3'>
            <div className='flex flex-wrap items-start justify-between gap-2'>
                <div>
                    <p className='text-sm font-semibold text-neutral-100'>
                        {formatStatus(action.actionType)} {formatStatus(action.targetType)}
                    </p>
                    <p className='mt-1 text-xs text-neutral-500'>{action.id}</p>
                </div>
                {action.status ? <span className='text-xs text-neutral-500'>{formatStatus(action.status)}</span> : null}
            </div>
            {action.preflightMessage ? (
                <p className='mt-2 text-xs leading-5 text-amber-100'>{action.preflightMessage}</p>
            ) : null}
            {changes.length > 0 ? (
                <dl className='mt-3 divide-y divide-neutral-800 border-y border-neutral-800'>
                    {changes.map((change) => (
                        <div
                            key={change.field}
                            className='grid gap-2 py-2 @min-[32rem]/blueprint-explorer:grid-cols-[8rem_minmax(0,1fr)]'>
                            <dt className='text-xs font-semibold text-neutral-200'>{formatStatus(change.field)}</dt>
                            <dd className='grid min-w-0 gap-2 text-xs text-neutral-400 @min-[42rem]/blueprint-explorer:grid-cols-2'>
                                <span className='min-w-0 break-words'>Before: {formatUnknown(change.before)}</span>
                                <span className='min-w-0 break-words'>After: {formatUnknown(change.after)}</span>
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </article>
    );
}

function DetailValue({ label, value }: { label: string; value: string }) {
    return (
        <div className='grid gap-2 py-2 @min-[30rem]/blueprint-explorer:grid-cols-[8rem_minmax(0,1fr)]'>
            <dt className='text-xs font-medium text-neutral-500'>{label}</dt>
            <dd className='min-w-0 font-mono text-xs break-all text-neutral-200'>{value}</dd>
        </div>
    );
}

function badgeClassName(badge: string): string {
    if (badge === 'blocked' || badge === 'failed' || badge === 'invalid' || badge === 'unsupported') {
        return 'text-rose-200';
    }
    if (badge === 'delete' || badge === 'destructive' || badge === 'permissions') {
        return 'text-amber-200';
    }
    if (badge === 'create') return 'text-emerald-200';

    return 'text-sky-200';
}

function readActionChanges(action: DashboardStructureExplorerAction): Array<{
    after: unknown;
    before: unknown;
    field: string;
}> {
    const changes = action.details.changes;
    if (!Array.isArray(changes)) return [];

    return changes.flatMap((change) =>
        change && typeof change === 'object' && typeof (change as Record<string, unknown>).field === 'string'
            ? [
                  {
                      after: (change as Record<string, unknown>).after,
                      before: (change as Record<string, unknown>).before,
                      field: (change as { field: string }).field,
                  },
              ]
            : []
    );
}

function readItemValue(item: unknown, field: string): unknown {
    return item && typeof item === 'object' ? (item as Record<string, unknown>)[field] : undefined;
}

function formatStatus(status: string): string {
    return status.replaceAll('_', ' ').replaceAll('-', ' ');
}

function formatUnknown(value: unknown): string {
    if (value === undefined) return 'unset';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    return JSON.stringify(value);
}
