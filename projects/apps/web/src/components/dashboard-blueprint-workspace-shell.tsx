import { Link } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { MouseEvent, ReactNode } from 'react';

import { dashboardBlueprintIdentity, dashboardBlueprintNavigationItems } from '../dashboard-blueprint-navigation.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    formatDashboardBlueprintRunPhase,
    formatDashboardBlueprintRunState,
} from '../server/dashboard-blueprint-contracts.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardSelectionTransition,
} from './dashboard-motion.js';
import type { DashboardBlueprintProgressTransport } from './dashboard-blueprint-run-progress.js';
import { DashboardFeaturePage } from './dashboard-ui.js';
import type { DashboardBlueprintSurface } from './dashboard-blueprint-surface.js';
import { DashboardBlueprintPendingSurface } from './dashboard-blueprint-surface-state.js';

export function DashboardBlueprintWorkspaceShell({
    guildId,
    pendingSurface,
    failedSurface,
    onNavigateSurface,
    activePlan,
    runProgressIssue,
    runTransport,
    showActiveRunStrip = true,
    children,
}: {
    guildId: string;
    pendingSurface?: DashboardBlueprintSurface;
    failedSurface?: DashboardBlueprintSurface;
    onNavigateSurface?: (surface: DashboardBlueprintSurface) => Promise<void>;
    activePlan?: Pick<DashboardBlueprintPlan, 'id' | 'run'>;
    runProgressIssue?: { code: string; planId: string };
    runTransport: DashboardBlueprintProgressTransport;
    showActiveRunStrip?: boolean;
    children: ReactNode;
}) {
    const activeRunStrip =
        showActiveRunStrip && activePlan?.run ? (
            <BlueprintRunStrip
                key={activePlan.id}
                guildId={guildId}
                plan={activePlan}
                hasProgressIssue={runProgressIssue?.planId === activePlan.id}
                transport={runTransport}
            />
        ) : undefined;

    return (
        <DashboardFeaturePage
            title={dashboardBlueprintIdentity.title}
            description={dashboardBlueprintIdentity.description}
            eyebrow={dashboardBlueprintIdentity.eyebrow}
            icon={<GitBranch className='size-5' aria-hidden='true' />}
            titleId='server-blueprint-title'
            width='full'
            surface='glass'
            navigation={
                <DashboardBlueprintNavigation
                    guildId={guildId}
                    pendingSurface={pendingSurface}
                    onNavigateSurface={onNavigateSurface}
                />
            }
            status={activeRunStrip ? <AnimatePresence initial={false}>{activeRunStrip}</AnimatePresence> : undefined}>
            {failedSurface ? (
                <DashboardBlueprintPendingSurface
                    surface={failedSurface}
                    error={{
                        diagnosticCode: 'BLUEPRINT_ROUTE_LOAD_FAILED',
                        retry: () => void onNavigateSurface?.(failedSurface),
                    }}
                />
            ) : pendingSurface ? (
                <DashboardBlueprintPendingSurface surface={pendingSurface} />
            ) : (
                children
            )}
        </DashboardFeaturePage>
    );
}

export function DashboardBlueprintNavigation({
    guildId,
    pendingSurface,
    onNavigateSurface,
}: {
    guildId: string;
    pendingSurface?: DashboardBlueprintSurface;
    onNavigateSurface?: (surface: DashboardBlueprintSurface) => Promise<void>;
}) {
    return (
        <nav
            className='flex min-w-0 gap-6 overflow-x-auto border-b border-[var(--dash-border)]'
            aria-label='Server Blueprint tools'>
            {dashboardBlueprintNavigationItems.map((item) => (
                <Link
                    key={item.id}
                    to={item.to}
                    params={{ guildId }}
                    onClick={(event) => {
                        if (!onNavigateSurface || !isPlainPrimaryClick(event)) return;
                        event.preventDefault();
                        void onNavigateSurface(item.id);
                    }}
                    className='relative flex min-h-11 shrink-0 items-center text-sm font-medium text-[var(--dash-text-muted)] transition-colors hover:text-[var(--dash-text)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)]'
                    activeProps={{ className: 'text-[var(--dash-text)]' }}>
                    {({ isActive }) => {
                        const selected = pendingSurface ? pendingSurface === item.id : isActive;
                        return (
                            <>
                                {item.label}
                                {selected ? (
                                    <motion.span
                                        layoutId='server-blueprint-active-tool'
                                        data-dashboard-motion='selection-gel'
                                        className='absolute inset-x-0 bottom-0 h-0.5 bg-[var(--dash-primary)]'
                                        transition={dashboardSelectionTransition}
                                    />
                                ) : null}
                            </>
                        );
                    }}
                </Link>
            ))}
        </nav>
    );
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
    return (
        !event.defaultPrevented &&
        event.button === 0 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
    );
}

function BlueprintRunStrip({
    guildId,
    plan,
    hasProgressIssue,
    transport,
}: {
    guildId: string;
    plan: Pick<DashboardBlueprintPlan, 'id' | 'run'>;
    hasProgressIssue: boolean;
    transport: DashboardBlueprintProgressTransport;
}) {
    const run = plan.run;
    if (!run) return null;

    const progress = run.totalSteps > 0 ? run.completedSteps / run.totalSteps : 0;
    const percent = Math.round(progress * 100);

    return (
        <motion.div
            data-dashboard-motion='confirmation'
            className='grid min-w-0 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)_auto] md:items-center md:gap-4'
            aria-label='Active Blueprint deployment'
            variants={dashboardConfirmationVariants}
            initial='initial'
            animate='enter'
            exit='exit'
            transition={dashboardConfirmationTransition}>
            <div className='min-w-0'>
                <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                    <span className='font-semibold text-[var(--dash-text)]'>Deployment active</span>
                    <span className='text-[var(--dash-text-muted)]'>{formatDashboardBlueprintRunState(run)}</span>
                    {run.currentStepLabel ? (
                        <span className='max-w-full truncate text-[var(--dash-text-subtle)]'>
                            · {run.currentStepLabel}
                        </span>
                    ) : null}
                </div>
                <p className={getTransportClassName(transport.mode, hasProgressIssue)}>
                    {formatTransportLabel(transport.mode)}
                    {transport.confirmedAt ? ` · confirmed ${formatRunTimestamp(transport.confirmedAt)}` : ''}
                </p>
            </div>
            <div className='min-w-0'>
                <div className='mb-1 flex justify-between gap-3 text-[11px] text-[var(--dash-text-subtle)]'>
                    <span>{percent}%</span>
                    <span>
                        {run.completedSteps}/{run.totalSteps} steps
                    </span>
                </div>
                <progress
                    className='sr-only'
                    value={run.completedSteps}
                    max={Math.max(1, run.totalSteps)}
                    aria-label={`${formatDashboardBlueprintRunPhase(run.phase)}: ${percent}%`}
                />
                <div
                    className='h-1.5 w-full overflow-hidden rounded-full bg-[var(--dash-surface-raised)]'
                    aria-hidden='true'>
                    <motion.div
                        data-dashboard-motion='confirmation'
                        className='h-full rounded-full bg-[var(--dash-primary)]'
                        initial={false}
                        animate={{ width: `${percent}%` }}
                        transition={dashboardConfirmationTransition}
                    />
                </div>
            </div>
            <div className='flex items-center gap-3 text-xs font-semibold'>
                <Link
                    to='/dashboard/$guildId/blueprint/deploy'
                    params={{ guildId }}
                    className='rounded-sm text-[var(--dash-primary)] outline-none hover:text-[var(--dash-primary-strong)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    Open deployment
                </Link>
                <Link
                    to='/dashboard/$guildId/blueprint/runs'
                    params={{ guildId }}
                    className='rounded-sm text-[var(--dash-text-muted)] outline-none hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    Runs
                </Link>
            </div>
        </motion.div>
    );
}

function formatRunTimestamp(value: number | string): string {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatTransportLabel(mode: DashboardBlueprintProgressTransport['mode']): string {
    switch (mode) {
        case 'live':
            return 'Live updates';
        case 'polling':
            return 'Polling fallback';
        case 'reconnecting':
            return 'Reconnecting to progress';
        case 'incompatible':
            return 'Progress protocol incompatible';
        case 'unavailable':
            return 'Progress transport unavailable';
        case 'idle':
            return 'Waiting for progress';
    }
}

function getTransportClassName(mode: DashboardBlueprintProgressTransport['mode'], hasProgressIssue: boolean): string {
    return mode === 'live' && !hasProgressIssue
        ? 'mt-1 text-xs text-[var(--dash-success)]'
        : mode === 'polling' && !hasProgressIssue
          ? 'mt-1 text-xs text-[var(--dash-text-muted)]'
          : 'mt-1 text-xs text-[var(--dash-warning)]';
}
