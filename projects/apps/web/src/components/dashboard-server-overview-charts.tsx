import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DashboardGuildOverview } from '../server/dashboard-overview.server.js';
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

    const chartData = overview.memberFlow.graph.map((day) => ({ ...day, leaveLoss: -day.leaves }));
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
const chartTooltipLabelStyle = { color: 'rgb(244 247 251)', fontWeight: 600 };
const chartTooltipItemStyle = { color: 'rgb(177 186 200)' };

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
    return [Number.isFinite(numericValue) ? String(numericValue) : String(value), 'Messages'];
}

function formatChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatLongChartDate(value: unknown): string {
    const text = String(value);
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
