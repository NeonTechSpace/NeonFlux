import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion } from 'motion/react';
import { useDeferredValue, useEffect, useMemo, useRef } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardAuditEventsRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardAuditEvent, DashboardAuditSearchScope } from '../server/dashboard-posting.server.js';
import { DashboardAuditEventRow, DashboardAuditEventsLoadMoreRow } from './dashboard-audit-event-row.js';
import {
    dashboardAuditSearchScopes,
    formatDashboardAuditSearchScope,
    useDashboardAuditUrlFilters,
} from './dashboard-audit-filters.js';
import { dashboardContentTransition, dashboardFastTransition, dashboardInlineVariants } from './dashboard-motion.js';
import {
    DashboardEmptyState,
    DashboardErrorState,
    DashboardStatus,
    DashboardSurface,
    DashboardToolbar,
} from './dashboard-ui.js';
import { getDashboardVirtualFallbackCount, getDashboardVirtualOverscan } from './dashboard-virtualization.js';

const auditPageSize = 40;
const auditViewportEstimate = 520;
const auditRowEstimate = 72;
const auditVirtualOverscan = getDashboardVirtualOverscan({
    viewportSize: auditViewportEstimate,
    itemSize: auditRowEstimate,
});
const auditVirtualFallbackCount = getDashboardVirtualFallbackCount({
    viewportSize: auditViewportEstimate,
    itemSize: auditRowEstimate,
});
export function DashboardAuditEventsPanel({ guildId }: { guildId: string }) {
    const { search, setSearch, searchScope, setSearchScope, clearFilters } = useDashboardAuditUrlFilters();
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
    const activeSearchScope =
        dashboardAuditSearchScopes.find((scope) => scope.value === searchScope) ?? dashboardAuditSearchScopes[0];

    return (
        <DashboardSurface
            as='section'
            padding='compact'
            aria-label='Audit event explorer'
            aria-busy={auditEventsQuery.isFetching}>
            <DashboardToolbar
                summary={
                    auditEventsQuery.isFetching && !auditEventsQuery.isFetchingNextPage
                        ? 'Refreshing events…'
                        : `${auditEvents.length} loaded`
                }>
                <label className='block min-w-44 space-y-1.5 text-sm font-medium text-[var(--dash-text)]'>
                    <span className='text-xs text-[var(--dash-text-muted)]'>Search in</span>
                    <select
                        value={searchScope}
                        onChange={(event) => setSearchScope(event.currentTarget.value as DashboardAuditSearchScope)}
                        className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] bg-[var(--dash-surface-muted)] px-3 text-sm text-[var(--dash-text)] transition outline-none focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)]'>
                        {dashboardAuditSearchScopes.map((scope) => (
                            <option key={scope.value} value={scope.value}>
                                {scope.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='block min-w-64 flex-1 space-y-1.5 text-sm font-medium text-[var(--dash-text)]'>
                    <span className='text-xs text-[var(--dash-text-muted)]'>Search events</span>
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] bg-[var(--dash-surface-muted)] px-3 text-sm text-[var(--dash-text)] transition outline-none placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)]'
                        placeholder={activeSearchScope.placeholder}
                        type='search'
                    />
                </label>
                <AnimatePresence initial={false}>
                    {search || searchScope !== 'all' ? (
                        <motion.button
                            key='clear-filters'
                            type='button'
                            onClick={clearFilters}
                            className='min-h-10 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-sm font-semibold text-[var(--dash-text-muted)] transition hover:border-[var(--dash-border-interactive)] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'
                            variants={dashboardInlineVariants}
                            initial='initial'
                            animate='enter'
                            exit='exit'
                            transition={dashboardFastTransition}>
                            Clear filters
                        </motion.button>
                    ) : null}
                </AnimatePresence>
            </DashboardToolbar>

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
                retry={auditEventsQuery.refetch}
            />
        </DashboardSurface>
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
    retry,
}: {
    events: DashboardAuditEvent[];
    search: string;
    searchScope: DashboardAuditSearchScope;
    channelNameById: ReadonlyMap<string, string>;
    hasNextPage: boolean;
    isLoading: boolean;
    isFetchingNextPage: boolean;
    isError: boolean;
    fetchNextPage: () => Promise<unknown>;
    retry: () => Promise<unknown>;
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
            <motion.div
                className='mt-4 space-y-2'
                aria-label='Loading audit events'
                variants={dashboardInlineVariants}
                initial='initial'
                animate='enter'
                transition={dashboardContentTransition}>
                {Array.from({ length: 5 }, (_, index) => (
                    <div
                        key={index}
                        className='h-16 animate-pulse rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'
                    />
                ))}
            </motion.div>
        );
    }

    if (isError && events.length === 0) {
        return (
            <motion.div
                className='mt-4'
                variants={dashboardInlineVariants}
                initial='initial'
                animate='enter'
                transition={dashboardContentTransition}>
                <DashboardErrorState
                    title='Audit events unavailable'
                    description='The persisted event history could not be loaded.'
                    action={
                        <button
                            type='button'
                            onClick={() => void retry()}
                            className='min-h-9 rounded-[var(--dash-radius-control)] border border-[var(--dash-danger)] px-3 text-xs font-semibold text-[var(--dash-text)] transition hover:bg-[var(--dash-danger-soft)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                            Try again
                        </button>
                    }
                />
            </motion.div>
        );
    }

    if (events.length === 0) {
        return (
            <motion.div
                variants={dashboardInlineVariants}
                initial='initial'
                animate='enter'
                transition={dashboardContentTransition}>
                <DashboardEmptyState
                    title={search ? 'No matching events' : 'No audit events yet'}
                    description={
                        search
                            ? `No persisted events match this search in ${formatDashboardAuditSearchScope(searchScope)}.`
                            : 'Dashboard and bot changes will appear here when they are recorded.'
                    }
                />
            </motion.div>
        );
    }

    return (
        <>
            <motion.div
                ref={scrollParentRef}
                className='mt-4 h-[34rem] overflow-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'
                aria-label='Dashboard audit events'
                role='list'
                initial={{ opacity: 0.72 }}
                animate={{ opacity: 1 }}
                transition={dashboardFastTransition}>
                <div
                    className='sticky top-0 z-10 hidden grid-cols-[minmax(18rem,1fr)_minmax(10rem,0.55fr)_minmax(10rem,0.45fr)_1.5rem] gap-3 border-b border-[var(--dash-border)] bg-[var(--dash-surface)] px-3 py-2 text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase md:grid'
                    aria-hidden='true'>
                    <span>Event</span>
                    <span>Actor</span>
                    <span>Time</span>
                    <span />
                </div>
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
                                className='absolute top-0 left-0 w-full border-b border-[var(--dash-border)] last:border-b-0'
                                style={{ transform: `translateY(${String(virtualItem.start)}px)` }}>
                                {event ? (
                                    <DashboardAuditEventRow event={event} channelNameById={channelNameById} />
                                ) : (
                                    <DashboardAuditEventsLoadMoreRow
                                        isFetchingNextPage={isFetchingNextPage}
                                        fetchNextPage={fetchNextPage}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </motion.div>
            {isError ? (
                <motion.div
                    className='mt-3'
                    variants={dashboardInlineVariants}
                    initial='initial'
                    animate='enter'
                    transition={dashboardFastTransition}>
                    <DashboardStatus tone='warning'>
                        Older events could not be loaded. The events above remain current.
                    </DashboardStatus>
                </motion.div>
            ) : null}
        </>
    );
}
