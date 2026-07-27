import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';

import { getDashboardOverviewQueryKey } from '../dashboard-query-keys.js';
import { readDashboardGuildOverviewRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardGuildOverview } from '../server/dashboard-overview-model.js';
import {
    dashboardContentTransition,
    dashboardContentVariants,
    dashboardFastTransition,
    dashboardInlineVariants,
} from './dashboard-motion.js';
import {
    dashboardDangerActionClassName,
    dashboardSecondaryActionClassName,
    DashboardEmptyState,
    DashboardErrorState,
    DashboardSurface,
    DashboardToolbar,
} from './dashboard-ui.js';
import {
    canRetryDashboardGuildRead,
    DashboardGuildReadError,
    readDashboardGuildReadFailureType,
} from './dashboard-guild-read-error.js';

const DashboardServerOverviewCharts = lazy(() =>
    import('./dashboard-server-overview-charts.js').then((module) => ({
        default: module.DashboardServerOverviewCharts,
    }))
);

export function DashboardServerOverviewPanel({ guildId }: { guildId: string }) {
    const [retrying, setRetrying] = useState(false);
    const overviewQuery = useQuery({
        queryKey: getDashboardOverviewQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardGuildOverviewRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'overview') {
                throw new DashboardGuildReadError(result.type);
            }

            return result.overview;
        },
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        retry: false,
        staleTime: 30_000,
    });
    const overview = overviewQuery.data;

    if (overviewQuery.isPending && !retrying) {
        return <DashboardServerOverviewLoading />;
    }

    if (overviewQuery.isError || !overview) {
        const failureType = readDashboardGuildReadFailureType(overviewQuery.error);
        const retryable = canRetryDashboardGuildRead(failureType);

        return (
            <DashboardErrorState
                title='Overview unavailable'
                description={getOverviewFailureDescription(failureType)}
                action={
                    failureType === 'auth-required' ? (
                        <a
                            href='/auth/fluxer/login'
                            className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                            Sign in again
                        </a>
                    ) : failureType === 'not-found' ? (
                        <Link
                            to='/dashboard'
                            className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                            Choose server
                        </Link>
                    ) : retryable ? (
                        <button
                            type='button'
                            onClick={() => {
                                if (retrying) return;
                                setRetrying(true);
                                void overviewQuery.refetch().finally(() => setRetrying(false));
                            }}
                            disabled={retrying}
                            aria-busy={retrying || undefined}
                            className={dashboardDangerActionClassName}>
                            {retrying ? 'Retrying…' : 'Retry overview'}
                        </button>
                    ) : undefined
                }
            />
        );
    }

    const hasActivity = overview.activityPresence.hasMemberFlow || overview.activityPresence.hasMessageActivity;

    return (
        <motion.div
            className='space-y-5'
            variants={dashboardContentVariants}
            initial='initial'
            animate='enter'
            transition={dashboardContentTransition}>
            {hasActivity ? (
                <>
                    <OverviewSummary overview={overview} refreshedAt={overviewQuery.dataUpdatedAt} />
                    <Suspense fallback={<OverviewChartsLoading />}>
                        <DashboardServerOverviewCharts overview={overview} />
                    </Suspense>
                </>
            ) : (
                <OverviewFirstUse />
            )}
        </motion.div>
    );
}

function getOverviewFailureDescription(type: ReturnType<typeof readDashboardGuildReadFailureType>): string {
    switch (type) {
        case 'auth-required':
            return 'Your session expired before the latest server activity could be loaded.';
        case 'not-found':
            return 'This server is no longer available for this account.';
        case 'deployment-config-not-found':
            return 'Dashboard activity is unavailable because this deployment is not fully configured.';
        case 'bot-token-missing':
            return 'Dashboard activity is unavailable because bot access is not configured.';
        case 'database-error':
        case 'guild-lookup-failed':
            return 'The latest server activity could not be loaded. The rest of the server dashboard remains available.';
    }
}

function OverviewChartsLoading() {
    return (
        <div className='grid gap-4 xl:grid-cols-2' role='status' aria-label='Loading activity charts'>
            {['Member flow', 'Member messages'].map((title) => (
                <DashboardSurface key={title}>
                    <h3 className='text-lg font-semibold text-[var(--dash-text)]'>{title}</h3>
                    <div className='mt-4 flex h-64 items-center text-sm text-[var(--dash-text-muted)]'>
                        Loading chart…
                    </div>
                </DashboardSurface>
            ))}
        </div>
    );
}

function DashboardServerOverviewLoading() {
    return (
        <DashboardSurface as='section' tone='glass' padding='compact' aria-label='Loading server overview'>
            <div role='status' className='flex min-h-12 items-center gap-3 text-sm text-[var(--dash-text-muted)]'>
                <span
                    data-dashboard-loading='pulse'
                    className='size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                    aria-hidden='true'
                />
                Loading server activity…
            </div>
        </DashboardSurface>
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
                    description='Member movement and member-authored messages will appear after NeonFlux observes them.'
                />
            </DashboardSurface>
        </motion.div>
    );
}

function OverviewSummary({ overview, refreshedAt }: { overview: DashboardGuildOverview; refreshedAt: number }) {
    return (
        <DashboardSurface
            tone='glass'
            padding='none'
            className='overflow-hidden'
            aria-label={`${String(overview.windowDays)}-day activity summary`}>
            <DashboardToolbar
                className='px-4 py-3'
                summary={
                    <span>
                        Loaded {formatRefreshTime(refreshedAt)}
                        {overview.oldestRetainedActivityAt
                            ? ` · Oldest retained activity ${formatDateTime(overview.oldestRetainedActivityAt)}`
                            : ''}
                    </span>
                }>
                <p className='text-sm font-semibold text-[var(--dash-text)]'>
                    Last {String(overview.windowDays)} day{overview.windowDays === 1 ? '' : 's'}
                </p>
            </DashboardToolbar>
            <dl className='grid md:grid-cols-2 md:divide-x md:divide-[var(--dash-border)]'>
                <SummaryMetric
                    label='Member movement'
                    value={
                        overview.activityPresence.hasMemberFlow
                            ? formatSignedNumber(overview.memberFlow.netGrowth)
                            : '—'
                    }
                    detail={
                        overview.activityPresence.hasMemberFlow
                            ? `${overview.memberFlow.totalJoins} joins / ${overview.memberFlow.totalLeaves} leaves`
                            : undefined
                    }
                />
                <SummaryMetric
                    label='Observed member messages'
                    value={overview.activityPresence.hasMessageActivity ? String(overview.messages.totalMessages) : '—'}
                    detail={overview.activityPresence.hasMessageActivity ? formatMessageSummary(overview) : undefined}
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
