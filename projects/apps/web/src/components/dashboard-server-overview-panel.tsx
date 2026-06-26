import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardOverviewQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardGuildOverview } from '../server/dashboard-overview.server.js';

type InviterSortMode = 'joins' | 'uses' | 'user';

export function DashboardServerOverviewPanel({ guildId }: { guildId: string }) {
    const [inviterSortMode, setInviterSortMode] = useState<InviterSortMode>('joins');
    const overviewQuery = useQuery({
        queryKey: getDashboardOverviewQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardGuildOverviewRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'overview') {
                throw new Error('Could not load server overview.');
            }

            return result.overview;
        },
    });
    const overview = overviewQuery.data;
    const sortedInviters = useMemo(
        () => sortInviters(overview?.invites.topInviters ?? [], inviterSortMode),
        [overview?.invites.topInviters, inviterSortMode]
    );

    if (overviewQuery.isPending) {
        return <DashboardServerOverviewLoading />;
    }

    if (overviewQuery.isError || !overview) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Server overview</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load server overview.</p>
            </article>
        );
    }

    return (
        <div className='space-y-4'>
            <OverviewCards overview={overview} />
            <MemberFlowGraph overview={overview} />
            <TopInvitersPanel
                overview={overview}
                sortedInviters={sortedInviters}
                sortMode={inviterSortMode}
                onSortModeChange={setInviterSortMode}
            />
        </div>
    );
}

export function DashboardServerOverviewLoading() {
    return (
        <section className='space-y-4' aria-label='Loading server overview'>
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                {Array.from({ length: 6 }, (_, index) => (
                    <article key={index} className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                        <div className='h-4 w-28 animate-pulse rounded bg-neutral-800' />
                        <div className='mt-4 h-7 w-20 animate-pulse rounded bg-neutral-800' />
                        <div className='mt-3 h-4 w-40 animate-pulse rounded bg-neutral-800' />
                    </article>
                ))}
            </div>
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <div className='h-4 w-36 animate-pulse rounded bg-neutral-800' />
                <div className='mt-4 h-44 animate-pulse rounded bg-neutral-800' />
            </article>
        </section>
    );
}

function OverviewCards({ overview }: { overview: DashboardGuildOverview }) {
    const trackingStarted = overview.trackingStartedAt
        ? `Tracking since ${formatDateTime(overview.trackingStartedAt)}.`
        : 'Tracking starts after NeonFlux receives new server activity.';
    const topInviter = overview.invites.topInviters.at(0);

    return (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            <MetricCard
                title='Tracking window'
                value='30 days'
                detail={trackingStarted}
                isEmpty={!overview.trackingStartedAt}
            />
            <MetricCard
                title='Member flow'
                value={formatSignedNumber(overview.memberFlow.netGrowth)}
                detail={`${overview.memberFlow.totalJoins} joins, ${overview.memberFlow.totalLeaves} leaves recorded.`}
                isEmpty={!overview.dataHealth.hasMemberFlow}
            />
            <MetricCard
                title='Active invites'
                value={String(overview.invites.activeInviteCount)}
                detail={`${overview.invites.totalInviteUses} total uses across active tracked invites.`}
                isEmpty={!overview.dataHealth.hasInviteSnapshots}
            />
            <MetricCard
                title='Top inviter'
                value={topInviter ? topInviter.inviterUserId : 'None yet'}
                detail={
                    topInviter ? `${topInviter.attributedJoins} attributed joins.` : 'No attributed invite joins yet.'
                }
                isEmpty={!topInviter}
            />
            <MetricCard
                title='Message activity'
                value={String(overview.messages.totalMessages)}
                detail={formatTopChannelDetail(overview)}
                isEmpty={!overview.dataHealth.hasMessageActivity}
            />
            <MetricCard
                title='Data health'
                value={formatHealthScore(overview)}
                detail={formatHealthDetail(overview)}
                isEmpty={!hasAnyTrackingData(overview)}
            />
        </div>
    );
}

function MetricCard({
    title,
    value,
    detail,
    isEmpty,
}: {
    title: string;
    value: string;
    detail: string;
    isEmpty: boolean;
}) {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <p className='text-sm font-medium text-neutral-400'>{title}</p>
            <p
                className={
                    isEmpty ? 'mt-3 text-2xl font-semibold text-neutral-300' : 'mt-3 text-2xl font-semibold text-white'
                }>
                {value}
            </p>
            <p className='mt-2 text-sm leading-6 text-neutral-400'>{detail}</p>
        </article>
    );
}

function MemberFlowGraph({ overview }: { overview: DashboardGuildOverview }) {
    const graph = overview.memberFlow.graph;
    const maxMagnitude = Math.max(1, ...graph.map((day) => Math.max(Math.abs(day.joins), Math.abs(day.leaves))));

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h3 className='text-lg font-semibold text-white'>Join and leave graph</h3>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>Last 30 UTC days of tracked member flow.</p>
                </div>
                <p className='text-sm text-neutral-400'>Net {formatSignedNumber(overview.memberFlow.netGrowth)}</p>
            </div>

            {!overview.dataHealth.hasMemberFlow ? (
                <p className='mt-4 text-sm leading-6 text-neutral-400'>
                    No member flow yet. Tracking starts when NeonFlux sees new join and leave events.
                </p>
            ) : (
                <div className='mt-5 h-56 overflow-x-auto'>
                    <div
                        className='grid h-full min-w-[42rem] items-end gap-1'
                        style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}>
                        {graph.map((day) => (
                            <div
                                key={day.date}
                                className='flex h-full flex-col justify-end gap-1'
                                title={formatGraphDay(day)}>
                                <div
                                    className='min-h-1 rounded-t bg-emerald-400'
                                    style={{ height: `${Math.max(4, (day.joins / maxMagnitude) * 45)}%` }}
                                    aria-label={`${day.date}: ${day.joins} joins`}
                                />
                                <div
                                    className='min-h-1 rounded-b bg-rose-400'
                                    style={{ height: `${Math.max(4, (day.leaves / maxMagnitude) * 45)}%` }}
                                    aria-label={`${day.date}: ${day.leaves} leaves`}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
}

function TopInvitersPanel({
    overview,
    sortedInviters,
    sortMode,
    onSortModeChange,
}: {
    overview: DashboardGuildOverview;
    sortedInviters: DashboardGuildOverview['invites']['topInviters'];
    sortMode: InviterSortMode;
    onSortModeChange: (mode: InviterSortMode) => void;
}) {
    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            role='region'
            aria-labelledby='dashboard-top-inviters-heading'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h3 id='dashboard-top-inviters-heading' className='text-lg font-semibold text-white'>
                        Top inviters
                    </h3>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Attributed joins grouped by inviter, with tracked invite codes under each user.
                    </p>
                </div>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Sort inviters</span>
                    <select
                        value={sortMode}
                        onChange={(event) => onSortModeChange(event.currentTarget.value as InviterSortMode)}
                        className='min-h-10 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                        <option value='joins'>Attributed joins</option>
                        <option value='uses'>Invite uses</option>
                        <option value='user'>User ID</option>
                    </select>
                </label>
            </div>

            {sortedInviters.length === 0 ? (
                <p className='mt-4 text-sm leading-6 text-neutral-400'>
                    No top inviters yet. Invite attribution starts after NeonFlux has a baseline invite snapshot.
                </p>
            ) : (
                <ul className='mt-4 divide-y divide-neutral-800'>
                    {sortedInviters.map((inviter) => (
                        <li key={inviter.inviterUserId} className='py-3 first:pt-0 last:pb-0'>
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                                <p className='font-mono text-sm font-semibold text-white'>{inviter.inviterUserId}</p>
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
                        </li>
                    ))}
                </ul>
            )}

            {overview.invites.attribution.unavailable > 0 ? (
                <p className='mt-4 text-xs leading-5 text-amber-300'>
                    {overview.invites.attribution.unavailable} joins could not be attributed because invite data was
                    unavailable.
                </p>
            ) : null}
        </article>
    );
}

function sortInviters(
    inviters: DashboardGuildOverview['invites']['topInviters'],
    mode: InviterSortMode
): DashboardGuildOverview['invites']['topInviters'] {
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

function getInviteUseTotal(inviter: DashboardGuildOverview['invites']['topInviters'][number]): number {
    return inviter.inviteCodes.reduce((total, invite) => total + invite.uses, 0);
}

function formatTopChannelDetail(overview: DashboardGuildOverview): string {
    const topChannel = overview.messages.topChannels.at(0);

    return topChannel
        ? `Top channel ${topChannel.channelId} with ${topChannel.messageCount} messages.`
        : 'No messages counted yet.';
}

function formatHealthScore(overview: DashboardGuildOverview): string {
    const healthyCount = [
        overview.dataHealth.hasMemberFlow,
        overview.dataHealth.hasInviteSnapshots,
        overview.dataHealth.hasMessageActivity,
    ].filter(Boolean).length;

    return `${healthyCount}/3`;
}

function formatHealthDetail(overview: DashboardGuildOverview): string {
    if (!hasAnyTrackingData(overview)) {
        return 'No tracked server data exists yet.';
    }

    return 'Member flow, invite snapshots, and message activity are tracked independently.';
}

function hasAnyTrackingData(overview: DashboardGuildOverview): boolean {
    return (
        overview.dataHealth.hasMemberFlow ||
        overview.dataHealth.hasInviteSnapshots ||
        overview.dataHealth.hasMessageActivity
    );
}

function formatSignedNumber(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatGraphDay(day: DashboardGuildOverview['memberFlow']['graph'][number]): string {
    return `${day.date}: ${day.joins} joins, ${day.leaves} leaves, net ${formatSignedNumber(day.netGrowth)}`;
}
