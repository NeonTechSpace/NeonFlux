import type { ReactNode } from 'react';

import type { DashboardAuditEvent } from '../server/dashboard-posting.server.js';

export function DashboardAuditEventRow({
    event,
    channelNameById,
}: {
    event: DashboardAuditEvent;
    channelNameById: ReadonlyMap<string, string>;
}) {
    const eventTone = getAuditEventTone(event);
    const details = getAuditEventDetails(event, channelNameById);
    const actorName = formatAuditActorName(event) ?? (event.actorUserId ? 'Dashboard user' : 'System');

    return (
        <details className={`group border-l-2 ${eventTone.leftBorderClassName}`} role='listitem'>
            <summary className='grid min-h-[4.5rem] cursor-pointer list-none gap-2 px-3 py-2 transition outline-none hover:bg-[var(--dash-surface-raised)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:shadow-[inset_0_0_0_2px_var(--dash-primary)] md:grid-cols-[minmax(18rem,1fr)_minmax(10rem,0.55fr)_minmax(10rem,0.45fr)_1.5rem] md:items-center md:gap-3 [&::-webkit-details-marker]:hidden'>
                <div className='min-w-0'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                        <span
                            className={`shrink-0 rounded-[var(--dash-radius-control)] border px-2 py-0.5 text-xs font-semibold ${eventTone.badgeClassName}`}>
                            {formatAuditFeature(event.feature)}
                        </span>
                        <span className='min-w-0 truncate font-mono text-sm font-semibold text-[var(--dash-text)]'>
                            {event.action}
                        </span>
                    </div>
                </div>
                <span className='truncate text-sm text-[var(--dash-text-muted)]'>{actorName}</span>
                <time dateTime={event.createdAt} className='text-sm text-[var(--dash-text-muted)]'>
                    {formatAuditEventTimestamp(event.createdAt)}
                </time>
                <span
                    className='text-lg text-[var(--dash-text-subtle)] transition group-open:rotate-90'
                    aria-hidden='true'>
                    ›
                </span>
            </summary>

            <div className='border-t border-[var(--dash-border)] bg-[var(--dash-surface)] px-3 py-3'>
                <p className='text-xs text-[var(--dash-text-subtle)]'>
                    Event ID <span className='font-mono text-[var(--dash-text-muted)]'>{event.id}</span>
                </p>
                <dl className='mt-2 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3'>
                    {details.map((detail) => (
                        <div
                            key={detail.label}
                            className='min-w-0 border-b border-[var(--dash-border)] py-2 last:border-b-0'>
                            <dt className='text-xs font-medium tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                                {detail.label}
                            </dt>
                            <dd className='mt-1 min-w-0 text-sm text-[var(--dash-text)]'>{detail.value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </details>
    );
}

export function DashboardAuditEventsLoadMoreRow({
    isFetchingNextPage,
    fetchNextPage,
}: {
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
}) {
    return (
        <div className='p-3' role='listitem'>
            <button
                type='button'
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
                className='min-h-10 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60'>
                {isFetchingNextPage ? 'Loading older events...' : 'Load older events'}
            </button>
        </div>
    );
}

function getAuditEventDetails(
    event: DashboardAuditEvent,
    channelNameById: ReadonlyMap<string, string>
): Array<{ label: string; value: ReactNode }> {
    const channelId = getMetadataString(event.metadata.channelId);
    const channelName =
        getMetadataString(event.metadata.channelName) ?? (channelId ? channelNameById.get(channelId) : undefined);
    const messageId =
        getMetadataString(event.metadata.messageId) ?? (event.feature === 'posting' ? event.targetId : undefined);
    const targetDetail = getAuditTargetDetail(event);
    const details = [
        {
            label: 'Actor',
            value: event.actorUserId ? (
                <NamedId name={formatAuditActorName(event)} id={event.actorUserId} />
            ) : (
                <MutedValue value='System' />
            ),
        },
        ...(channelId
            ? [
                  {
                      label: 'Channel',
                      value: <NamedId name={channelName ? `#${channelName}` : undefined} id={channelId} />,
                  },
              ]
            : []),
        ...(targetDetail ? [targetDetail] : []),
        ...(messageId
            ? [
                  {
                      label: 'Message',
                      value: <MonoValue value={messageId} />,
                  },
              ]
            : []),
        ...getAuditMetadataDetails(event),
    ];

    return details;
}

function getAuditTargetDetail(event: DashboardAuditEvent): { label: string; value: ReactNode } | undefined {
    if (!event.targetId) return undefined;

    if (event.feature === 'import_export') {
        return {
            label: getStructureAuditTargetLabel(event.action),
            value: <MonoValue value={event.targetId} />,
        };
    }

    if (event.feature !== 'posting') {
        return {
            label: 'Target',
            value: <MonoValue value={event.targetId} />,
        };
    }

    return undefined;
}

function getStructureAuditTargetLabel(action: string): string {
    if (action === 'structure.backup_restore_point_created' || action.startsWith('structure.import_')) {
        return 'Import run';
    }

    if (
        action === 'structure.backup_settings_updated' ||
        action === 'structure.backup_retention_pruned' ||
        action.startsWith('structure.scheduled_drift_')
    ) {
        return 'Guild/settings target';
    }

    if (action.startsWith('structure.backup_')) {
        return 'Backup target';
    }

    return 'Target';
}

function getAuditMetadataDetails(event: DashboardAuditEvent) {
    const metadata = event.metadata;
    const baseDetails = [
        formatMetadataDetail('Content length', metadata.contentLength),
        formatMetadataDetail('Embeds', metadata.embedCount),
        formatMetadataDetail('Source', metadata.source),
    ].filter((detail): detail is { label: string; value: string } => Boolean(detail));

    if (event.feature !== 'import_export') return baseDetails;

    return [
        ...baseDetails,
        formatMetadataDetail('Actions', metadata.actionCount),
        formatMetadataDetail('Creates', metadata.createCount),
        formatMetadataDetail('Updates', metadata.updateCount),
        formatMetadataDetail('Deletes', metadata.deleteCount),
        formatMetadataDetail('Applied', metadata.appliedCount),
        formatMetadataDetail('Failed', metadata.failedCount),
        formatMetadataDetail('Backup', metadata.backupName ?? metadata.backupId),
        formatMetadataDetail('Backup source', metadata.backupSource),
        formatMetadataDetail('Restore point', metadata.restorePointBackupId),
        formatMetadataDetail('Retention deleted', metadata.deletedCount),
        formatMetadataDetail('Drift status', metadata.status),
        formatMetadataDetail('Drift changes', metadata.changeCount),
    ].filter((detail): detail is { label: string; value: string } => Boolean(detail));
}

function formatMetadataDetail(label: string, value: unknown): { label: string; value: string } | undefined {
    if (typeof value === 'string' && value.trim()) {
        return { label, value };
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return { label, value: String(value) };
    }

    return undefined;
}

function NamedId({ name, id }: { name?: string; id: string }) {
    return (
        <span className='block min-w-0'>
            {name ? <span className='block truncate font-semibold text-[var(--dash-text)]'>{name}</span> : null}
            <span className='block truncate font-mono text-xs text-[var(--dash-text-subtle)]'>{id}</span>
        </span>
    );
}

function formatAuditActorName(event: DashboardAuditEvent): string | undefined {
    if (event.actorUsername) {
        return `@${event.actorUsername}`;
    }

    return event.actorDisplayName;
}

function MonoValue({ value }: { value: string }) {
    return <span className='block truncate font-mono text-xs text-[var(--dash-text-muted)]'>{value}</span>;
}

function MutedValue({ value }: { value: string }) {
    return <span className='text-[var(--dash-text-subtle)]'>{value}</span>;
}

function getMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function getAuditEventTone(event: DashboardAuditEvent) {
    if (event.feature === 'posting') {
        return {
            leftBorderClassName: 'border-l-4 border-l-[var(--dash-live)]',
            badgeClassName: 'border-[var(--dash-live)] bg-[var(--dash-primary-soft)] text-[var(--dash-text)]',
        };
    }

    if (event.feature === 'settings') {
        return {
            leftBorderClassName: 'border-l-4 border-l-[var(--dash-creative)]',
            badgeClassName: 'border-[var(--dash-creative)] bg-[var(--dash-accent-soft)] text-[var(--dash-text)]',
        };
    }

    if (event.feature === 'security' || event.feature === 'access') {
        return {
            leftBorderClassName: 'border-l-4 border-l-[var(--dash-warning)]',
            badgeClassName: 'border-[var(--dash-warning)] bg-[var(--dash-warning-soft)] text-[var(--dash-text)]',
        };
    }

    return {
        leftBorderClassName: 'border-l-4 border-l-[var(--dash-border-strong)]',
        badgeClassName: 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)] text-[var(--dash-text-muted)]',
    };
}

function formatAuditFeature(feature: string): string {
    return feature
        .split('_')
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function formatAuditEventTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
