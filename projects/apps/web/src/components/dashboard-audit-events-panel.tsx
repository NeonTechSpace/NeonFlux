import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardAuditEventsRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardAuditEvent, DashboardAuditSearchScope } from '../server/dashboard-posting.server.js';
import { getDashboardVirtualFallbackCount, getDashboardVirtualOverscan } from './dashboard-virtualization.js';

const auditPageSize = 40;
const auditViewportEstimate = 520;
const auditRowEstimate = 176;
const auditVirtualOverscan = getDashboardVirtualOverscan({
    viewportSize: auditViewportEstimate,
    itemSize: auditRowEstimate,
});
const auditVirtualFallbackCount = getDashboardVirtualFallbackCount({
    viewportSize: auditViewportEstimate,
    itemSize: auditRowEstimate,
});
const auditSearchScopes = [
    { value: 'all', label: 'All fields', placeholder: 'Feature, action, actor, channel, message...' },
    { value: 'event', label: 'Event type', placeholder: 'posting, message.sent, settings...' },
    { value: 'actor', label: 'Actor', placeholder: 'Actor username or ID...' },
    { value: 'channel', label: 'Channel', placeholder: 'Channel name or ID...' },
    { value: 'message', label: 'Message', placeholder: 'Message ID...' },
    { value: 'time', label: 'Time', placeholder: 'Date or UTC timestamp...' },
    { value: 'metadata', label: 'Metadata', placeholder: 'dashboard, embed count, content length...' },
] as const satisfies ReadonlyArray<{
    value: DashboardAuditSearchScope;
    label: string;
    placeholder: string;
}>;

type ChannelNameById = Map<string, string>;

export function DashboardAuditEventsPanel({ guildId }: { guildId: string }) {
    const [search, setSearch] = useState('');
    const [searchScope, setSearchScope] = useState<DashboardAuditSearchScope>('all');
    const deferredSearch = useDeferredValue(search.trim());
    const searchOffsetMinutes = new Date().getTimezoneOffset();
    const auditEventsQuery = useInfiniteQuery({
        queryKey: getDashboardAuditEventsQueryKey(guildId, deferredSearch, searchScope, searchOffsetMinutes),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await readDashboardAuditEventsRouteData({
                data: {
                    guildId,
                    limit: auditPageSize,
                    searchScope,
                    searchOffsetMinutes,
                    ...(pageParam ? { cursor: pageParam } : {}),
                    ...(deferredSearch ? { search: deferredSearch } : {}),
                },
            });

            if (result.type !== 'events') {
                throw new Error('Could not load audit events.');
            }

            return result;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
    const postingChannelsQuery = useQuery({
        queryKey: getDashboardPostingChannelsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingChannelsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'channels') {
                throw new Error('Could not load channel names.');
            }

            return result.channels;
        },
    });
    const auditEvents = useMemo(
        () => auditEventsQuery.data?.pages.flatMap((page) => page.auditEvents) ?? [],
        [auditEventsQuery.data]
    );
    const channelNameById = useMemo(
        () => new Map((postingChannelsQuery.data ?? []).map((channel) => [channel.id, channel.name])),
        [postingChannelsQuery.data]
    );
    const activeSearchScope = auditSearchScopes.find((scope) => scope.value === searchScope) ?? auditSearchScopes[0];

    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-busy={auditEventsQuery.isFetching}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Audit events</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Search persisted dashboard and bot-app changes for this server.
                    </p>
                </div>
                {auditEventsQuery.isFetching && !auditEventsQuery.isFetchingNextPage ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Loading
                    </span>
                ) : null}
            </div>

            <div className='mt-4 grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]'>
                <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Search in</span>
                    <select
                        value={searchScope}
                        onChange={(event) => setSearchScope(event.currentTarget.value as DashboardAuditSearchScope)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                        {auditSearchScopes.map((scope) => (
                            <option key={scope.value} value={scope.value}>
                                {scope.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Search events</span>
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        placeholder={activeSearchScope.placeholder}
                        type='search'
                    />
                </label>
            </div>

            <AuditEventsBody
                events={auditEvents}
                search={deferredSearch}
                searchScope={searchScope}
                channelNameById={channelNameById}
                hasNextPage={auditEventsQuery.hasNextPage}
                isLoading={auditEventsQuery.isPending}
                isFetchingNextPage={auditEventsQuery.isFetchingNextPage}
                isError={auditEventsQuery.isError}
                fetchNextPage={auditEventsQuery.fetchNextPage}
            />
        </article>
    );
}

function AuditEventsBody({
    events,
    search,
    searchScope,
    channelNameById,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    isError,
    fetchNextPage,
}: {
    events: DashboardAuditEvent[];
    search: string;
    searchScope: DashboardAuditSearchScope;
    channelNameById: ChannelNameById;
    hasNextPage: boolean;
    isLoading: boolean;
    isFetchingNextPage: boolean;
    isError: boolean;
    fetchNextPage: () => Promise<unknown>;
}) {
    const scrollParentRef = useRef<HTMLDivElement | null>(null);
    const rowCount = events.length + (hasNextPage ? 1 : 0);
    // TanStack Virtual intentionally returns imperative measurement functions.
    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollParentRef.current,
        estimateSize: () => auditRowEstimate,
        overscan: auditVirtualOverscan,
        initialRect: {
            width: 960,
            height: auditViewportEstimate,
        },
    });
    const virtualItems = rowVirtualizer.getVirtualItems();
    const renderedVirtualItems =
        virtualItems.length > 0
            ? virtualItems
            : Array.from({ length: Math.min(rowCount, auditVirtualFallbackCount) }, (_, index) => ({
                  key: index,
                  index,
                  start: index * auditRowEstimate,
              }));
    const lastVirtualIndex = renderedVirtualItems.at(-1)?.index;

    useEffect(() => {
        if (
            lastVirtualIndex === undefined ||
            !hasNextPage ||
            isFetchingNextPage ||
            lastVirtualIndex < Math.max(events.length - 4, 0)
        ) {
            return;
        }

        void fetchNextPage();
    }, [events.length, fetchNextPage, hasNextPage, isFetchingNextPage, lastVirtualIndex]);

    if (isLoading) {
        return (
            <div className='mt-4 space-y-3' aria-label='Loading audit events'>
                <div className='h-4 w-44 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
            </div>
        );
    }

    if (isError && events.length === 0) {
        return <p className='mt-4 text-sm text-rose-300'>Could not load audit events.</p>;
    }

    if (events.length === 0) {
        return (
            <p className='mt-4 text-sm leading-6 text-neutral-400'>
                {search ? `No matching audit events in ${formatSearchScope(searchScope)}.` : 'No audit events yet.'}
            </p>
        );
    }

    return (
        <>
            <p className='mt-4 text-xs text-neutral-500'>
                Loaded {events.length} {search ? `matching ${formatSearchScope(searchScope)} ` : ''}events
                {hasNextPage ? '. Scroll to load older events.' : '.'}
            </p>
            <div
                ref={scrollParentRef}
                className='mt-2 h-[34rem] overflow-auto rounded-md border border-neutral-800 bg-neutral-950/60 p-2'
                aria-label='Dashboard audit events'
                role='list'>
                <div
                    className='relative w-full'
                    style={{ height: `${Math.max(rowVirtualizer.getTotalSize(), rowCount * auditRowEstimate)}px` }}>
                    {renderedVirtualItems.map((virtualItem) => {
                        const event = virtualItem.index < events.length ? events[virtualItem.index] : undefined;

                        return (
                            <div
                                key={virtualItem.key}
                                data-index={virtualItem.index}
                                ref={rowVirtualizer.measureElement}
                                className='absolute top-0 left-0 w-full pb-2'
                                style={{ transform: `translateY(${String(virtualItem.start)}px)` }}>
                                {event ? (
                                    <AuditEventRow event={event} channelNameById={channelNameById} />
                                ) : (
                                    <AuditEventsLoadMoreRow
                                        isFetchingNextPage={isFetchingNextPage}
                                        fetchNextPage={fetchNextPage}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            {isError ? <p className='mt-3 text-xs text-rose-300'>Could not load more audit events.</p> : null}
        </>
    );
}

function AuditEventRow({ event, channelNameById }: { event: DashboardAuditEvent; channelNameById: ChannelNameById }) {
    const eventTone = getAuditEventTone(event);
    const details = getAuditEventDetails(event, channelNameById);

    return (
        <article
            className={`rounded-lg border ${eventTone.borderClassName} bg-neutral-900/95 p-4 shadow-sm ${eventTone.leftBorderClassName}`}
            role='listitem'>
            <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_max-content]'>
                <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                        <span
                            className={`rounded-md border px-2 py-1 text-xs font-semibold ${eventTone.badgeClassName}`}>
                            {event.feature}
                        </span>
                        <span className='font-mono text-sm font-semibold text-white'>{event.action}</span>
                    </div>
                    <p className='mt-2 text-xs text-neutral-500'>Event ID: {event.id}</p>
                </div>
                <time dateTime={event.createdAt} className='text-sm font-medium text-neutral-300 md:text-right'>
                    {formatAuditEventTimestamp(event.createdAt)}
                </time>
            </div>

            <dl className='mt-4 divide-y divide-neutral-800 border-t border-neutral-800'>
                {details.map((detail) => (
                    <div key={detail.label} className='grid gap-2 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)]'>
                        <dt className='text-xs font-medium tracking-wide text-neutral-500 uppercase'>{detail.label}</dt>
                        <dd className='min-w-0 text-sm text-neutral-200'>{detail.value}</dd>
                    </div>
                ))}
            </dl>
        </article>
    );
}

function AuditEventsLoadMoreRow({
    isFetchingNextPage,
    fetchNextPage,
}: {
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
}) {
    return (
        <div className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' role='listitem'>
            <button
                type='button'
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
                className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-60'>
                {isFetchingNextPage ? 'Loading older events...' : 'Load older events'}
            </button>
        </div>
    );
}

function getAuditEventDetails(
    event: DashboardAuditEvent,
    channelNameById: ChannelNameById
): Array<{ label: string; value: ReactNode }> {
    const channelId = getMetadataString(event.metadata.channelId);
    const channelName =
        getMetadataString(event.metadata.channelName) ?? (channelId ? channelNameById.get(channelId) : undefined);
    const messageId = getMetadataString(event.metadata.messageId) ?? event.targetId;
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
        ...(messageId
            ? [
                  {
                      label: 'Message',
                      value: <MonoValue value={messageId} />,
                  },
              ]
            : []),
        ...getAuditMetadataDetails(event.metadata),
    ];

    return details;
}

function getAuditMetadataDetails(metadata: Record<string, unknown>) {
    return [
        formatMetadataDetail('Content length', metadata.contentLength),
        formatMetadataDetail('Embeds', metadata.embedCount),
        formatMetadataDetail('Source', metadata.source),
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
            {name ? <span className='block truncate font-semibold text-white'>{name}</span> : null}
            <span className='block truncate font-mono text-xs text-neutral-500'>{id}</span>
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
    return <span className='block truncate font-mono text-xs text-neutral-300'>{value}</span>;
}

function MutedValue({ value }: { value: string }) {
    return <span className='text-neutral-500'>{value}</span>;
}

function getMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function getAuditEventTone(event: DashboardAuditEvent) {
    if (event.feature === 'posting') {
        return {
            borderClassName: 'border-cyan-500/25',
            leftBorderClassName: 'border-l-4 border-l-cyan-400',
            badgeClassName: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100',
        };
    }

    if (event.feature === 'settings') {
        return {
            borderClassName: 'border-violet-500/25',
            leftBorderClassName: 'border-l-4 border-l-violet-400',
            badgeClassName: 'border-violet-400/40 bg-violet-400/10 text-violet-100',
        };
    }

    if (event.feature === 'security' || event.feature === 'access') {
        return {
            borderClassName: 'border-amber-500/25',
            leftBorderClassName: 'border-l-4 border-l-amber-400',
            badgeClassName: 'border-amber-400/40 bg-amber-400/10 text-amber-100',
        };
    }

    return {
        borderClassName: 'border-neutral-800',
        leftBorderClassName: 'border-l-4 border-l-neutral-600',
        badgeClassName: 'border-neutral-700 bg-neutral-800 text-neutral-200',
    };
}

function formatSearchScope(scope: DashboardAuditSearchScope): string {
    return auditSearchScopes.find((option) => option.value === scope)?.label.toLowerCase() ?? 'all fields';
}

function formatAuditEventTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
