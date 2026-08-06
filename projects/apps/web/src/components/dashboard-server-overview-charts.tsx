import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DashboardGuildOverview } from '../server/dashboard-overview-model.js';
import { DashboardEmptyState, DashboardSurface } from './dashboard-ui.js';

type MemberFlowChartDay = DashboardGuildOverview['memberFlow']['graph'][number] & { leaveLoss: number };

export function DashboardServerOverviewCharts({ overview }: { overview: DashboardGuildOverview }) {
    return (
        <div className='grid gap-4 xl:grid-cols-2'>
            <MemberFlowChart overview={overview} />
            <MessageActivityChart overview={overview} />
        </div>
    );
}

function MemberFlowChart({ overview }: { overview: DashboardGuildOverview }) {
    if (!overview.activityPresence.hasMemberFlow) {
        return (
            <ChartPanel title='Member flow' legendItems={[]}>
                <DashboardEmptyState
                    title='No member movement yet'
                    description='Joins and leaves will be charted after they are observed.'
                />
            </ChartPanel>
        );
    }

    const chartData = overview.memberFlow.graph.map((day) => ({ ...day, leaveLoss: -day.leaves }));
    const domain = getMemberFlowDomain(chartData);

    return (
        <ChartPanel
            title='Member flow'
            summary={formatMemberFlowChartSummary(overview.memberFlow.graph)}
            legendItems={[
                { label: 'Joins', className: 'bg-[var(--dash-live)]' },
                { label: 'Leaves', className: 'bg-[var(--dash-creative)]' },
                { label: 'Net', className: 'bg-[var(--dash-text-muted)]' },
            ]}>
            <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={chartData} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <CartesianGrid
                        stroke='var(--dash-border)'
                        strokeOpacity={0.7}
                        strokeDasharray='4 4'
                        vertical={false}
                    />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--dash-text-muted)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--dash-text-muted)', fontSize: 12 }}
                        tickFormatter={(value) => String(Math.abs(Number(value)))}
                    />
                    <Tooltip
                        cursor={{ stroke: 'var(--dash-primary)', strokeOpacity: 0.35 }}
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
    if (!overview.activityPresence.hasMessageActivity) {
        return (
            <ChartPanel title='Member messages' legendItems={[]}>
                <DashboardEmptyState
                    title='No member message activity yet'
                    description='Daily member-authored message counts will appear after activity is observed.'
                />
            </ChartPanel>
        );
    }

    const domain = getMessageActivityDomain(overview.messages.graph);
    return (
        <ChartPanel
            title='Member messages'
            summary={formatMessageChartSummary(overview.messages.graph)}
            legendItems={[{ label: 'Member messages', className: 'bg-[var(--dash-live)]' }]}>
            <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={overview.messages.graph} margin={{ top: 12, right: 10, bottom: 0, left: -16 }}>
                    <defs>
                        <linearGradient id='messageActivityFill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='5%' stopColor='var(--dash-live)' stopOpacity={0.34} />
                            <stop offset='95%' stopColor='var(--dash-live)' stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        stroke='var(--dash-border)'
                        strokeOpacity={0.7}
                        strokeDasharray='4 4'
                        vertical={false}
                    />
                    <XAxis
                        dataKey='date'
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--dash-text-muted)', fontSize: 12 }}
                        tickFormatter={formatChartDate}
                    />
                    <YAxis
                        domain={domain}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--dash-text-muted)', fontSize: 12 }}
                    />
                    <Tooltip
                        cursor={{ stroke: 'var(--dash-primary)', strokeOpacity: 0.35 }}
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={formatMessageTooltipValue}
                        labelFormatter={formatLongChartDate}
                    />
                    <Area
                        type='monotone'
                        dataKey='messageCount'
                        name='Member messages'
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
    summary,
    legendItems,
    children,
}: {
    title: string;
    summary?: string;
    legendItems: Array<{ label: string; className: string }>;
    children: ReactNode;
}) {
    return (
        <DashboardSurface>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <h3 className='text-lg font-semibold text-[var(--dash-text)]'>{title}</h3>
                {legendItems.length > 0 ? <ChartLegend items={legendItems} /> : null}
            </div>
            {summary ? <p className='sr-only'>{summary}</p> : null}
            <div className='mt-4 h-64'>{children}</div>
        </DashboardSurface>
    );
}

function ChartLegend({ items }: { items: Array<{ label: string; className: string }> }) {
    return (
        <div className='flex flex-wrap gap-3 text-xs font-semibold text-[var(--dash-text-muted)]'>
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
    backgroundColor: 'var(--dash-surface-raised)',
    border: '1px solid var(--dash-border)',
    borderRadius: '8px',
    color: 'var(--dash-text)',
};
const chartTooltipLabelStyle = { color: 'var(--dash-text)', fontWeight: 600 };
const chartTooltipItemStyle = { color: 'var(--dash-text-muted)' };

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
    return [
        Number.isFinite(numericValue) ? String(Math.abs(numericValue)) : String(value),
        typeof name === 'string' ? name : 'Value',
    ];
}

function formatMessageTooltipValue(value: unknown): [string, string] {
    const numericValue = typeof value === 'number' ? value : Number(value);
    return [Number.isFinite(numericValue) ? String(numericValue) : String(value), 'Member messages'];
}

function formatMemberFlowChartSummary(data: DashboardGuildOverview['memberFlow']['graph']): string {
    return `Daily member movement. ${data
        .map(
            (day) =>
                `${formatLongChartDate(day.date)}: ${String(day.joins)} joins, ${String(day.leaves)} leaves, net ${formatSignedChartValue(day.netGrowth)}`
        )
        .join('; ')}.`;
}

function formatMessageChartSummary(data: DashboardGuildOverview['messages']['graph']): string {
    return `Daily observed member messages. ${data
        .map((day) => `${formatLongChartDate(day.date)}: ${String(day.messageCount)}`)
        .join('; ')}.`;
}

function formatSignedChartValue(value: number): string {
    return value > 0 ? `+${String(value)}` : String(value);
}

function formatChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatLongChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
