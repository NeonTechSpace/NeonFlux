import { useQuery } from '@tanstack/react-query';

import { getDashboardAuditEventsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardAuditEventsRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardAuditEvent } from '../server/dashboard-posting.server.js';

export function DashboardAuditEventsPanel({ guildId }: { guildId: string }) {
    const auditEventsQuery = useQuery({
        queryKey: getDashboardAuditEventsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardAuditEventsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'events') {
                throw new Error('Could not load audit events.');
            }

            return result.auditEvents;
        },
    });

    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-busy={auditEventsQuery.isFetching}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Audit events</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Recent dashboard and bot-app changes for this server.
                    </p>
                </div>
                {auditEventsQuery.isFetching ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Loading
                    </span>
                ) : null}
            </div>

            <AuditEventsBody
                events={auditEventsQuery.data ?? []}
                isLoading={auditEventsQuery.isPending}
                isError={auditEventsQuery.isError}
            />
        </article>
    );
}

function AuditEventsBody({
    events,
    isLoading,
    isError,
}: {
    events: DashboardAuditEvent[];
    isLoading: boolean;
    isError: boolean;
}) {
    if (isLoading) {
        return (
            <div className='mt-4 space-y-3' aria-label='Loading audit events'>
                <div className='h-4 w-44 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
            </div>
        );
    }

    if (isError) {
        return <p className='mt-4 text-sm text-rose-300'>Could not load audit events.</p>;
    }

    if (events.length === 0) {
        return <p className='mt-4 text-sm leading-6 text-neutral-400'>No audit events yet.</p>;
    }

    return (
        <ul className='mt-4 divide-y divide-neutral-800'>
            {events.map((event) => (
                <li key={event.id} className='py-3 first:pt-0 last:pb-0'>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div>
                            <p className='text-sm font-semibold text-white'>
                                {event.feature}: {event.action}
                            </p>
                            <p className='mt-1 text-xs text-neutral-500'>{formatAuditEventMetadata(event.metadata)}</p>
                        </div>
                        <time dateTime={event.createdAt} className='text-xs text-neutral-500'>
                            {formatAuditEventTimestamp(event.createdAt)}
                        </time>
                    </div>
                    {event.actorUserId ? (
                        <p className='mt-2 text-xs text-neutral-500'>Actor: {event.actorUserId}</p>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

function formatAuditEventMetadata(metadata: Record<string, unknown>): string {
    const parts = [
        formatMetadataValue('Channel', metadata.channelId),
        formatMetadataValue('Message', metadata.messageId),
        formatMetadataValue('Content length', metadata.contentLength),
        formatMetadataValue('Embeds', metadata.embedCount),
        formatMetadataValue('Source', metadata.source),
    ].filter((part): part is string => Boolean(part));

    return parts.length > 0 ? parts.join(' | ') : 'No metadata';
}

function formatMetadataValue(label: string, value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
        return `${label}: ${value}`;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${label}: ${value}`;
    }

    return undefined;
}

function formatAuditEventTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
