import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { getDashboardOverviewQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardGuildOverview } from '../server/dashboard-overview.server.js';
import {
    dashboardContentTransition,
    dashboardContentVariants,
    dashboardFastTransition,
    dashboardInlineVariants,
} from './dashboard-motion.js';
import { DashboardEmptyState, DashboardErrorState, DashboardSurface, DashboardToolbar } from './dashboard-ui.js';

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
            <DashboardErrorState
                title='Overview unavailable'
                description='The latest server activity could not be loaded.'
                action={
                    <button
                        type='button'
                        onClick={() => void overviewQuery.refetch()}
                        className='min-h-10 rounded-[var(--dash-radius-control)] border border-[var(--dash-danger)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:bg-[var(--dash-danger-soft)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                        Try again
                    </button>
                }
            />
        );
    }

    const hasActivity = overview.dataHealth.hasMemberFlow || overview.dataHealth.hasMessageActivity;

    return (
        <motion.div
            className='mx-auto max-w-[90rem] space-y-5'
            variants={dashboardContentVariants}
            initial='initial'
            animate='enter'
            transition={dashboardContentTransition}>
            {hasActivity ? (
                <>
                    <OverviewSummary overview={overview} refreshedAt={overviewQuery.dataUpdatedAt} />
                    <div className='grid gap-4 xl:grid-cols-2'>
                        <MemberFlowChart overview={overview} />
                        <MessageActivityChart overview={overview} />
                    </div>
                </>
            ) : (
                <OverviewFirstUse />
            )}
        </motion.div>
    );
}

export function DashboardServerOverviewLoading() {
    return (
        <section className='mx-auto max-w-[90rem] space-y-5' aria-label='Loading server overview'>
            <DashboardSurface as='div'>
                <div className='h-4 w-52 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                <div className='mt-5 grid gap-3 md:grid-cols-2'>
                    {Array.from({ length: 2 }, (_, index) => (
                        <div
                            key={index}
                            className='space-y-3 border-[var(--dash-border)] first:border-l-0 md:border-l md:pl-4'>
                            <div className='h-3 w-24 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                            <div className='h-7 w-16 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                            <div className='h-3 w-32 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                        </div>
                    ))}
                </div>
            </DashboardSurface>
            <div className='grid gap-4 xl:grid-cols-2'>
                <DashboardSurface as='div' className='h-80'>
                    <div className='h-4 w-36 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                    <div className='mt-5 h-60 animate-pulse rounded bg-[rgba(19,24,35,0.7)]' />
                </DashboardSurface>
                <DashboardSurface as='div' className='h-80'>
                    <div className='h-4 w-36 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                    <div className='mt-5 h-60 animate-pulse rounded bg-[rgba(19,24,35,0.7)]' />
                </DashboardSurface>
            </div>
        </section>
    );
}

function OverviewFirstUse() {
    return (
        <motion.div
            variants={dashboardInlineVariants}
            initial='initial'
            animate='enter'
            transition={dashboardFastTransition}>
            <DashboardSurface tone='glass' padding='compact'>
                <DashboardEmptyState
                    size='compact'
                    title='Listening for activity'
                    description='Member movement and messages will appear after NeonFlux observes them.'
                />
            </DashboardSurface>
        </motion.div>
    );
}

function OverviewSummary({ overview, refreshedAt }: { overview: DashboardGuildOverview; refreshedAt: number }) {
    return (
        <DashboardSurface tone='glass' padding='none' className='overflow-hidden' aria-label='30-day activity summary'>
            <DashboardToolbar
                className='px-4 py-3'
                summary={
                    <span>
                        Refreshed {formatRefreshTime(refreshedAt)}
                        {overview.trackingStartedAt
                            ? ` · Tracking since ${formatDateTime(overview.trackingStartedAt)}`
                            : ''}
                    </span>
                }>
                <p className='text-sm font-semibold text-[var(--dash-text)]'>Last 30 days</p>
            </DashboardToolbar>
            <dl className='grid md:grid-cols-2 md:divide-x md:divide-[var(--dash-border)]'>
                <SummaryMetric
                    label='Member movement'
                    value={overview.dataHealth.hasMemberFlow ? formatSignedNumber(overview.memberFlow.netGrowth) : '—'}
                    detail={
                        overview.dataHealth.hasMemberFlow
                            ? `${overview.memberFlow.totalJoins} joins / ${overview.memberFlow.totalLeaves} leaves`
                            : undefined
                    }
                />
                <SummaryMetric
                    label='Messages'
                    value={overview.dataHealth.hasMessageActivity ? String(overview.messages.totalMessages) : '—'}
                    detail={overview.dataHealth.hasMessageActivity ? formatMessageSummary(overview) : undefined}
                />
            </dl>
        </DashboardSurface>
    );
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className='min-w-0 p-4'>
            <dt className='text-xs font-semibold tracking-wide text-[var(--dash-text-muted)] uppercase'>{label}</dt>
            <motion.dd
                key={value}
                className='mt-2 truncate text-[1.7rem] leading-tight font-semibold text-[var(--dash-text)]'
                variants={dashboardInlineVariants}
                initial='initial'
                animate='enter'
                transition={dashboardFastTransition}>
                {value}
            </motion.dd>
            {detail ? <dd className='mt-1 truncate text-[0.95rem] text-[var(--dash-text-muted)]'>{detail}</dd> : null}
        </div>
    );
}

function MemberFlowChart({ overview }: { overview: DashboardGuildOverview }) {
    if (!overview.dataHealth.hasMemberFlow) {
        return (
            <ChartPanel title='Member flow' legendItems={[]}>
                <DashboardEmptyState
                    title='No member movement yet'
                    description='Joins and leaves will be charted after they are observed.'
                />
            </ChartPanel>
        );
    }

    const chartData = overview.memberFlow.graph.map((day) => ({
        ...day,
        leaveLoss: -day.leaves,
    }));
    const domain = getMemberFlowDomain(chartData);

    return (
        <ChartPanel
            title='Member flow'
            legendItems={[
                { label: 'Joins', className: 'bg-[var(--dash-live)]' },
                { label: 'Leaves', className: 'bg-[var(--dash-creative)]' },
                { label: 'Net', className: 'bg-[var(--dash-text-muted)]' },
            ]}>
            <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={chartData} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke='rgba(135,146,165,0.16)' strokeDasharray='4 4' vertical={false} />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(177 186 200)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(177 186 200)', fontSize: 12 }}
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
                        stroke='var(--dash-live)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type='monotone'
                        dataKey='leaveLoss'
                        name='Leaves'
                        stroke='var(--dash-creative)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type='monotone'
                        dataKey='netGrowth'
                        name='Net'
                        stroke='var(--dash-text-muted)'
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
    if (!overview.dataHealth.hasMessageActivity) {
        return (
            <ChartPanel title='Message activity' legendItems={[]}>
                <DashboardEmptyState
                    title='No message activity yet'
                    description='Daily message counts will appear after activity is observed.'
                />
            </ChartPanel>
        );
    }

    const domain = getMessageActivityDomain(overview.messages.graph);

    return (
        <ChartPanel title='Message activity' legendItems={[{ label: 'Messages', className: 'bg-[var(--dash-live)]' }]}>
            <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={overview.messages.graph} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <defs>
                        <linearGradient id='messageActivityFill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='5%' stopColor='var(--dash-live)' stopOpacity={0.34} />
                            <stop offset='95%' stopColor='var(--dash-live)' stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid stroke='rgba(135,146,165,0.16)' strokeDasharray='4 4' vertical={false} />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(177 186 200)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'rgb(177 186 200)', fontSize: 12 }}
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
                        stroke='var(--dash-live)'
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
    legendItems,
    children,
}: {
    title: string;
    legendItems: Array<{ label: string; className: string }>;
    children: ReactNode;
}) {
    return (
        <DashboardSurface>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <h3 className='text-lg font-semibold text-[var(--dash-text)]'>{title}</h3>
                {legendItems.length > 0 ? <ChartLegend items={legendItems} /> : null}
            </div>
            <div className='mt-4 h-64'>{children}</div>
        </DashboardSurface>
    );
}

function ChartLegend({ items }: { items: Array<{ label: string; className: string }> }) {
    return (
        <div className='flex flex-wrap gap-3 text-xs font-semibold text-[var(--dash-text-muted)]' aria-hidden='true'>
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
    backgroundColor: 'rgb(7 8 11)',
    border: '1px solid rgb(34 41 56)',
    borderRadius: '8px',
    color: 'rgb(244 247 251)',
};
const chartTooltipLabelStyle = {
    color: 'rgb(244 247 251)',
    fontWeight: 600,
};
const chartTooltipItemStyle = {
    color: 'rgb(177 186 200)',
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

function formatMessageSummary(overview: DashboardGuildOverview): string | undefined {
    const activeDays = overview.messages.graph.filter((day) => day.messageCount > 0).length;

    return activeDays > 0 ? `${activeDays} active day${activeDays === 1 ? '' : 's'}` : undefined;
}

function formatSignedNumber(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatRefreshTime(value: number): string {
    if (value <= 0) return 'recently';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? 'recently'
        : date.toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
          });
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
