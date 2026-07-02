import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';

import { getDashboardOverviewQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardGuildOverview } from '../server/dashboard-overview.server.js';
import { getDashboardVirtualOverscan } from './dashboard-virtualization.js';

type InviterSortMode = 'joins' | 'uses' | 'user';
type TopInviter = DashboardGuildOverview['invites']['topInviters'][number];

const inviterRowEstimate = 88;
const inviterViewportEstimate = 448;
const inviterVirtualOverscan = getDashboardVirtualOverscan({
    viewportSize: inviterViewportEstimate,
    itemSize: inviterRowEstimate,
});

export function DashboardInviteTrackingPanel({ guildId }: { guildId: string }) {
    const [sortMode, setSortMode] = useState<InviterSortMode>('joins');
    const overviewQuery = useQuery({
        queryKey: getDashboardOverviewQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardGuildOverviewRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'overview') {
                throw new Error('Could not load invite tracking.');
            }

            return result.overview;
        },
    });
    const overview = overviewQuery.data;
    const sortedInviters = useMemo(
        () => sortInviters(overview?.invites.topInviters ?? [], sortMode),
        [overview?.invites.topInviters, sortMode]
    );

    if (overviewQuery.isPending) {
        return <DashboardInviteTrackingLoading />;
    }

    if (overviewQuery.isError || !overview) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Invite tracking</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load invite tracking.</p>
            </article>
        );
    }

    return (
        <div className='space-y-5'>
            <InviteTrackingSummary overview={overview} />
            <TopInvitersPanel
                overview={overview}
                sortedInviters={sortedInviters}
                sortMode={sortMode}
                onSortModeChange={setSortMode}
            />
        </div>
    );
}

export function DashboardInviteTrackingLoading() {
    return (
        <section className='space-y-5' aria-label='Loading invite tracking'>
            <div className='rounded-lg border border-neutral-800 bg-neutral-900/70 p-4'>
                <div className='h-4 w-44 animate-pulse rounded bg-neutral-800' />
                <div className='mt-5 grid gap-3 md:grid-cols-3'>
                    {Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className='space-y-3 border-neutral-800 first:border-l-0 md:border-l md:pl-4'>
                            <div className='h-3 w-24 animate-pulse rounded bg-neutral-800' />
                            <div className='h-7 w-16 animate-pulse rounded bg-neutral-800' />
                            <div className='h-3 w-32 animate-pulse rounded bg-neutral-800' />
                        </div>
                    ))}
                </div>
            </div>
            <div className='h-80 rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <div className='h-4 w-32 animate-pulse rounded bg-neutral-800' />
                <div className='mt-5 space-y-3'>
                    {Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className='h-16 animate-pulse rounded bg-neutral-800/70' />
                    ))}
                </div>
            </div>
        </section>
    );
}

function InviteTrackingSummary({ overview }: { overview: DashboardGuildOverview }) {
    const attribution = overview.invites.attribution;
    const unattributed = attribution.baselineMissing + attribution.ambiguous + attribution.unavailable;

    return (
        <section className='rounded-lg border border-neutral-800 bg-neutral-900/70'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-sm font-semibold text-white'>Invite attribution</h3>
                <p className='mt-1 text-xs text-neutral-500'>
                    Tracking starts after NeonFlux captures a baseline invite snapshot.
                </p>
            </div>
            <dl className='grid divide-y divide-neutral-800 md:grid-cols-3 md:divide-x md:divide-y-0'>
                <SummaryMetric
                    label='Active invites'
                    value={String(overview.invites.activeInviteCount)}
                    detail={`${overview.invites.totalInviteUses} tracked uses`}
                />
                <SummaryMetric
                    label='Attributed joins'
                    value={String(attribution.attributed)}
                    detail={`${unattributed} joins need stronger invite data`}
                />
                <SummaryMetric
                    label='Known inviters'
                    value={String(overview.invites.topInviters.length)}
                    detail={
                        overview.dataHealth.hasInviteSnapshots ? 'Baseline snapshot exists' : 'Waiting for baseline'
                    }
                />
            </dl>
        </section>
    );
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className='min-w-0 p-4'>
            <dt className='text-xs font-medium tracking-wide text-neutral-500 uppercase'>{label}</dt>
            <dd className='mt-2 truncate text-2xl font-semibold text-white'>{value}</dd>
            <dd className='mt-1 truncate text-sm text-neutral-400'>{detail}</dd>
        </div>
    );
}

function TopInvitersPanel({
    overview,
    sortedInviters,
    sortMode,
    onSortModeChange,
}: {
    overview: DashboardGuildOverview;
    sortedInviters: TopInviter[];
    sortMode: InviterSortMode;
    onSortModeChange: (mode: InviterSortMode) => void;
}) {
    const scrollParentRef = useRef<HTMLDivElement>(null);
    // TanStack Virtual intentionally returns imperative measurement functions.
    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: sortedInviters.length,
        getScrollElement: () => scrollParentRef.current,
        estimateSize: () => inviterRowEstimate,
        overscan: inviterVirtualOverscan,
        initialRect: {
            width: 960,
            height: inviterViewportEstimate,
        },
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const renderedRows =
        virtualRows.length > 0
            ? virtualRows.map((row) => ({ inviter: sortedInviters[row.index], offset: row.start }))
            : sortedInviters.map((inviter, index) => ({ inviter, offset: index * inviterRowEstimate }));

    return (
        <section
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-labelledby='dashboard-top-inviters-heading'>
            <div className='grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start'>
                <div className='min-w-0'>
                    <h3 id='dashboard-top-inviters-heading' className='text-lg font-semibold text-white'>
                        Top inviters
                    </h3>
                    <p className='mt-1 max-w-3xl text-sm leading-6 text-neutral-400'>
                        Attributed joins grouped by inviter, with tracked invite codes under each user.
                    </p>
                </div>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Sort inviters</span>
                    <select
                        value={sortMode}
                        onChange={(event) => onSortModeChange(event.currentTarget.value as InviterSortMode)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                        <option value='joins'>Attributed joins</option>
                        <option value='uses'>Invite uses</option>
                        <option value='user'>User ID</option>
                    </select>
                </label>
            </div>

            {sortedInviters.length === 0 ? (
                <p className='mt-6 text-sm leading-6 text-neutral-400'>
                    No top inviters yet. Invite attribution starts after NeonFlux has a baseline invite snapshot.
                </p>
            ) : (
                <div
                    ref={scrollParentRef}
                    className='mt-5 max-h-[28rem] overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/50'
                    aria-label='Top inviter rows'>
                    <ul
                        className='relative'
                        style={{
                            height: rowVirtualizer.getTotalSize() || sortedInviters.length * inviterRowEstimate,
                        }}>
                        {renderedRows.map(({ inviter, offset }) => (
                            <li
                                key={inviter.inviterUserId}
                                className='absolute inset-x-0 border-b border-neutral-800 px-4 py-3 last:border-b-0'
                                style={{
                                    transform: `translateY(${offset}px)`,
                                }}>
                                <TopInviterRow inviter={inviter} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {overview.invites.attribution.unavailable > 0 ? (
                <p className='mt-4 text-xs leading-5 text-amber-300'>
                    {overview.invites.attribution.unavailable} joins could not be attributed because invite data was
                    unavailable.
                </p>
            ) : null}
        </section>
    );
}

function TopInviterRow({ inviter }: { inviter: TopInviter }) {
    return (
        <div className='min-w-0'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='min-w-0 truncate font-mono text-sm font-semibold text-white'>{inviter.inviterUserId}</p>
                <p className='text-sm text-neutral-400'>{inviter.attributedJoins} attributed joins</p>
            </div>
            <div className='mt-2 flex flex-wrap gap-2'>
                {inviter.inviteCodes.map((invite) => (
                    <span
                        key={invite.code}
                        className='rounded-md border border-neutral-700 px-2 py-1 font-mono text-xs text-neutral-300'>
                        {invite.code} · {invite.uses} uses{invite.active ? '' : ' · inactive'}
                    </span>
                ))}
            </div>
        </div>
    );
}

function sortInviters(inviters: TopInviter[], mode: InviterSortMode): TopInviter[] {
    return [...inviters].sort((left, right) => {
        if (mode === 'uses') {
            return (
                getInviteUseTotal(right) - getInviteUseTotal(left) ||
                left.inviterUserId.localeCompare(right.inviterUserId)
            );
        }

        if (mode === 'user') {
            return left.inviterUserId.localeCompare(right.inviterUserId);
        }

        return right.attributedJoins - left.attributedJoins || left.inviterUserId.localeCompare(right.inviterUserId);
    });
}

function getInviteUseTotal(inviter: TopInviter): number {
    return inviter.inviteCodes.reduce((total, invite) => total + invite.uses, 0);
}
