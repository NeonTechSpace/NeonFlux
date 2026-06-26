import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { getDashboardOverviewQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardGuildOverview } from '../server/dashboard-overview.server.js';

type MemberFlowChartDay = DashboardGuildOverview['memberFlow']['graph'][number] & {
    leaveLoss: number;
};

export function DashboardServerOverviewPanel({ guildId }: { guildId: string }) {
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
        <div className='space-y-5'>
            <OverviewSummary overview={overview} />
            <div className='grid gap-4 xl:grid-cols-2'>
                <MemberFlowChart overview={overview} />
                <MessageActivityChart overview={overview} />
            </div>
        </div>
    );
}

export function DashboardServerOverviewLoading() {
    return (
        <section className='space-y-5' aria-label='Loading server overview'>
            <div className='rounded-lg border border-neutral-800 bg-neutral-900/70 p-4'>
                <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
                <div className='mt-5 grid gap-3 md:grid-cols-2'>
                    {Array.from({ length: 2 }, (_, index) => (
                        <div key={index} className='space-y-3 border-neutral-800 first:border-l-0 md:border-l md:pl-4'>
                            <div className='h-3 w-24 animate-pulse rounded bg-neutral-800' />
                            <div className='h-7 w-16 animate-pulse rounded bg-neutral-800' />
                            <div className='h-3 w-32 animate-pulse rounded bg-neutral-800' />
                        </div>
                    ))}
                </div>
            </div>
            <div className='grid gap-4 xl:grid-cols-2'>
                <div className='h-80 rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                    <div className='h-4 w-36 animate-pulse rounded bg-neutral-800' />
                    <div className='mt-5 h-60 animate-pulse rounded bg-neutral-800/70' />
                </div>
                <div className='h-80 rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                    <div className='h-4 w-36 animate-pulse rounded bg-neutral-800' />
                    <div className='mt-5 h-60 animate-pulse rounded bg-neutral-800/70' />
                </div>
            </div>
        </section>
    );
}

function OverviewSummary({ overview }: { overview: DashboardGuildOverview }) {
    return (
        <section className='rounded-lg border border-neutral-800 bg-neutral-900/70'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Last 30 days</p>
                    <p className='mt-1 text-xs text-neutral-500'>{formatTrackingWindow(overview)}</p>
                </div>
                {overview.trackingStartedAt ? (
                    <p className='text-xs text-neutral-500'>
                        Tracking since {formatDateTime(overview.trackingStartedAt)}
                    </p>
                ) : null}
            </div>
            <dl className='grid divide-y divide-neutral-800 md:grid-cols-2 md:divide-x md:divide-y-0'>
                <SummaryMetric
                    label='Member change'
                    value={formatSignedNumber(overview.memberFlow.netGrowth)}
                    detail={`${overview.memberFlow.totalJoins} joins / ${overview.memberFlow.totalLeaves} leaves`}
                />
                <SummaryMetric
                    label='Messages'
                    value={String(overview.messages.totalMessages)}
                    detail={formatMessageSummary(overview)}
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

function MemberFlowChart({ overview }: { overview: DashboardGuildOverview }) {
    const chartData = overview.memberFlow.graph.map((day) => ({
        ...day,
        leaveLoss: -day.leaves,
    }));
    const domain = getMemberFlowDomain(chartData);

    return (
        <ChartPanel
            title='Member flow'
            detail={`Overall change ${formatSignedNumber(overview.memberFlow.netGrowth)} from ${overview.memberFlow.totalJoins} joins and ${overview.memberFlow.totalLeaves} leaves.`}
            legendItems={[
                { label: 'Joins', className: 'bg-emerald-400' },
                { label: 'Leaves', className: 'bg-rose-400' },
                { label: 'Overall change', className: 'bg-sky-400' },
            ]}
            empty={!overview.dataHealth.hasMemberFlow}
            emptyText='No member flow recorded yet. The chart stays on the baseline until join or leave events arrive.'>
            <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={chartData} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke='rgb(38 38 38)' strokeDasharray='4 4' vertical={false} />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(115 115 115)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(115 115 115)', fontSize: 12 }}
                        tickFormatter={(value) => String(Math.abs(Number(value)))}
                    />
                    <Tooltip
                        cursor={{ stroke: 'rgb(14 165 233)', strokeOpacity: 0.35 }}
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={formatMemberFlowTooltipValue}
                        labelFormatter={formatLongChartDate}
                    />
                    <Line
                        type='monotone'
                        dataKey='joins'
                        name='Joins'
                        stroke='rgb(52 211 153)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type='monotone'
                        dataKey='leaveLoss'
                        name='Leaves'
                        stroke='rgb(251 113 133)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type='monotone'
                        dataKey='netGrowth'
                        name='Overall change'
                        stroke='rgb(56 189 248)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </ChartPanel>
    );
}

function MessageActivityChart({ overview }: { overview: DashboardGuildOverview }) {
    const domain = getMessageActivityDomain(overview.messages.graph);

    return (
        <ChartPanel
            title='Message activity'
            detail={`${overview.messages.totalMessages} tracked messages across visible channel activity.`}
            legendItems={[{ label: 'Messages', className: 'bg-sky-400' }]}
            empty={!overview.dataHealth.hasMessageActivity}
            emptyText='No messages counted yet. The chart stays flat until new non-bot messages are tracked.'>
            <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={overview.messages.graph} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <defs>
                        <linearGradient id='messageActivityFill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='5%' stopColor='rgb(56 189 248)' stopOpacity={0.45} />
                            <stop offset='95%' stopColor='rgb(56 189 248)' stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid stroke='rgb(38 38 38)' strokeDasharray='4 4' vertical={false} />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(115 115 115)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(115 115 115)', fontSize: 12 }}
                    />
                    <Tooltip
                        cursor={{ stroke: 'rgb(14 165 233)', strokeOpacity: 0.35 }}
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={formatMessageTooltipValue}
                        labelFormatter={formatLongChartDate}
                    />
                    <Area
                        type='monotone'
                        dataKey='messageCount'
                        name='Messages'
                        stroke='rgb(56 189 248)'
                        strokeWidth={2}
                        fill='url(#messageActivityFill)'
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </ChartPanel>
    );
}

function ChartPanel({
    title,
    detail,
    legendItems,
    empty,
    emptyText,
    children,
}: {
    title: string;
    detail: string;
    legendItems: Array<{ label: string; className: string }>;
    empty: boolean;
    emptyText: string;
    children: ReactNode;
}) {
    return (
        <section className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h3 className='text-lg font-semibold text-white'>{title}</h3>
                    <p className='mt-1 text-sm leading-6 text-neutral-400'>{detail}</p>
                </div>
                <ChartLegend items={legendItems} />
            </div>
            <div className='mt-4 h-64'>{children}</div>
            {empty ? <p className='mt-3 text-xs leading-5 text-neutral-500'>{emptyText}</p> : null}
        </section>
    );
}

function ChartLegend({ items }: { items: Array<{ label: string; className: string }> }) {
    return (
        <div className='flex flex-wrap gap-3 text-xs text-neutral-400' aria-hidden='true'>
            {items.map((item) => (
                <span key={item.label} className='inline-flex items-center gap-1'>
                    <span className={`size-2 rounded-full ${item.className}`} />
                    {item.label}
                </span>
            ))}
        </div>
    );
}

const chartTooltipStyle = {
    backgroundColor: 'rgb(10 10 10)',
    border: '1px solid rgb(38 38 38)',
    borderRadius: '8px',
    color: 'rgb(245 245 245)',
};
const chartTooltipLabelStyle = {
    color: 'rgb(229 229 229)',
    fontWeight: 600,
};
const chartTooltipItemStyle = {
    color: 'rgb(212 212 212)',
};

function getMemberFlowDomain(data: MemberFlowChartDay[]): [number, number] {
    const maxMagnitude = Math.max(
        0,
        ...data.map((day) => Math.max(Math.abs(day.joins), Math.abs(day.leaveLoss), Math.abs(day.netGrowth)))
    );
    const domain = maxMagnitude === 0 ? 1 : maxMagnitude;

    return [-domain, domain];
}

function getMessageActivityDomain(data: DashboardGuildOverview['messages']['graph']): [number, number] {
    const maxMessages = Math.max(0, ...data.map((day) => day.messageCount));

    return [0, maxMessages === 0 ? 1 : maxMessages];
}

function formatMemberFlowTooltipValue(value: unknown, name: unknown): [string, string] {
    const numericValue = typeof value === 'number' ? value : Number(value);
    const label = typeof name === 'string' ? name : 'Value';

    return [Number.isFinite(numericValue) ? String(Math.abs(numericValue)) : String(value), label];
}

function formatMessageTooltipValue(value: unknown): [string, string] {
    const numericValue = typeof value === 'number' ? value : Number(value);

    return [Number.isFinite(numericValue) ? String(numericValue) : String(value), 'Messages'];
}

function formatMessageSummary(overview: DashboardGuildOverview): string {
    const topChannel = overview.messages.topChannels.at(0);

    return topChannel ? `${topChannel.messageCount} in the busiest tracked channel` : 'No messages counted yet';
}

function formatTrackingWindow(overview: DashboardGuildOverview): string {
    return overview.trackingStartedAt
        ? 'Tracked activity inside the current rolling window.'
        : 'Tracking starts when NeonFlux receives new server activity.';
}

function formatSignedNumber(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);

    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
          });
}

function formatLongChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);

    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
          });
}
