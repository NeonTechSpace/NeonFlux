import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { getDashboardAuditEventsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardAuditEventsRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardAuditEvent } from '../server/dashboard-posting.server.js';

const auditPageSize = 40;
const auditVirtualOverscan = 8;

export function DashboardAuditEventsPanel({ guildId }: { guildId: string }) {
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const auditEventsQuery = useInfiniteQuery({
        queryKey: getDashboardAuditEventsQueryKey(guildId, deferredSearch),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await readDashboardAuditEventsRouteData({
                data: {
                    guildId,
                    limit: auditPageSize,
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
    const auditEvents = useMemo(
        () => auditEventsQuery.data?.pages.flatMap((page) => page.auditEvents) ?? [],
        [auditEventsQuery.data]
    );

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

            <label className='mt-4 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>Search events</span>
                <input
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    placeholder='Feature, action, actor, channel, message...'
                    type='search'
                />
            </label>

            <AuditEventsBody
                events={auditEvents}
                search={deferredSearch}
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
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    isError,
    fetchNextPage,
}: {
    events: DashboardAuditEvent[];
    search: string;
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
        estimateSize: () => 96,
        overscan: auditVirtualOverscan,
        initialRect: {
            width: 960,
            height: 520,
        },
    });
    const virtualItems = rowVirtualizer.getVirtualItems();
    const renderedVirtualItems =
        virtualItems.length > 0
            ? virtualItems
            : Array.from({ length: Math.min(rowCount, auditPageSize) }, (_, index) => ({
                  key: index,
                  index,
                  start: index * 96,
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
                {search ? 'No matching audit events.' : 'No audit events yet.'}
            </p>
        );
    }

    return (
        <>
            <p className='mt-4 text-xs text-neutral-500'>
                Loaded {events.length} {search ? 'matching ' : ''}events
                {hasNextPage ? '. Scroll to load older events.' : '.'}
            </p>
            <div
                ref={scrollParentRef}
                className='mt-2 h-[34rem] overflow-auto rounded-md border border-neutral-800 bg-neutral-950/60'
                aria-label='Dashboard audit events'
                role='list'>
                <div
                    className='relative w-full'
                    style={{ height: `${Math.max(rowVirtualizer.getTotalSize(), rowCount * 96)}px` }}>
                    {renderedVirtualItems.map((virtualItem) => {
                        const event = virtualItem.index < events.length ? events[virtualItem.index] : undefined;

                        return (
                            <div
                                key={virtualItem.key}
                                data-index={virtualItem.index}
                                ref={rowVirtualizer.measureElement}
                                className='absolute top-0 left-0 w-full'
                                style={{ transform: `translateY(${String(virtualItem.start)}px)` }}>
                                {event ? (
                                    <AuditEventRow event={event} />
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

function AuditEventRow({ event }: { event: DashboardAuditEvent }) {
    return (
        <div className='border-b border-neutral-800 px-4 py-3 last:border-b-0' role='listitem'>
            <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold text-white'>
                        {event.feature}: {event.action}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-neutral-500'>
                        {formatAuditEventMetadata(event.metadata)}
                    </p>
                </div>
                <time dateTime={event.createdAt} className='shrink-0 text-xs text-neutral-500'>
                    {formatAuditEventTimestamp(event.createdAt)}
                </time>
            </div>
            {event.actorUserId ? <p className='mt-2 text-xs text-neutral-500'>Actor: {event.actorUserId}</p> : null}
        </div>
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
        <div className='px-4 py-3' role='listitem'>
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
        return `${label}: ${String(value)}`;
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
