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
            <div className='p-3'>
                <p className='text-sm font-semibold text-white'>Select an item</p>
                <p className='mt-2 text-xs leading-5 text-neutral-400'>
                    Choose a role, category, channel, or planned action to inspect details.
                </p>
            </div>
        );
    }

    return (
        <div className='space-y-4 p-3'>
            <div>
                <p className='text-xs font-medium text-neutral-500 uppercase'>{formatStatus(metadata.kind)}</p>
                <h5 className='mt-1 text-base font-semibold text-white'>{metadata.label}</h5>
                <p className='mt-1 text-xs text-neutral-500'>{source.label}</p>
            </div>

            <div className='grid gap-2 sm:grid-cols-2'>
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
            </div>

            {metadata.badges.length > 0 ? (
                <div>
                    <p className='text-xs font-medium text-neutral-500 uppercase'>Badges</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        {metadata.badges.map((badge) => (
                            <span
                                key={badge}
                                className={`rounded-md border px-2 py-1 text-xs font-semibold ${badgeClassName(badge)}`}>
                                {formatStatus(badge)}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {metadata.risks.length > 0 ? (
                <div className='rounded-md border border-amber-400/25 bg-amber-400/10 p-3'>
                    <p className='text-xs font-semibold text-amber-100'>Risk flags</p>
                    <ul className='mt-2 space-y-1 text-xs leading-5 text-neutral-200'>
                        {metadata.risks.map((risk) => (
                            <li key={risk}>{risk}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {metadata.actions.length > 0 ? (
                <div>
                    <p className='text-xs font-medium text-neutral-500 uppercase'>Related actions</p>
                    <div className='mt-2 space-y-2'>
                        {metadata.actions.map((action) => (
                            <ActionDetails key={action.id} action={action} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ActionDetails({ action }: { action: DashboardStructureExplorerAction }) {
    const changes = readActionChanges(action);

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950 p-3'>
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
                <dl className='mt-3 space-y-2'>
                    {changes.map((change) => (
                        <div key={change.field} className='rounded-md border border-neutral-800 bg-neutral-900/60 p-2'>
                            <dt className='text-xs font-semibold text-neutral-200'>{formatStatus(change.field)}</dt>
                            <dd className='mt-1 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2'>
                                <span>Before: {formatUnknown(change.before)}</span>
                                <span>After: {formatUnknown(change.after)}</span>
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </div>
    );
}

function DetailValue({ label, value }: { label: string; value: string }) {
    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950 p-2'>
            <p className='text-xs font-medium text-neutral-500 uppercase'>{label}</p>
            <p className='mt-1 text-sm break-all text-neutral-200'>{value}</p>
        </div>
    );
}

function badgeClassName(badge: string): string {
    if (badge === 'blocked' || badge === 'failed' || badge === 'invalid' || badge === 'unsupported') {
        return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
    }
    if (badge === 'delete' || badge === 'destructive' || badge === 'permissions') {
        return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
    }
    if (badge === 'create') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';

    return 'border-sky-400/30 bg-sky-400/10 text-sky-100';
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
