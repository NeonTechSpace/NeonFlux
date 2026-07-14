import { Link } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { MouseEvent, ReactNode } from 'react';

import { dashboardStructureIdentity, dashboardStructureNavigationItems } from '../dashboard-structure-navigation.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import {
    formatDashboardStructureExecutionPhase,
    formatDashboardStructureExecutionState,
} from '../server/dashboard-structure-contracts.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardSelectionTransition,
} from './dashboard-motion.js';
import type { DashboardStructureProgressTransport } from './dashboard-structure-execution-progress.js';
import { DashboardFeaturePage } from './dashboard-ui.js';
import type { DashboardStructureSurface } from './dashboard-structure-surface.js';
import { DashboardStructurePendingSurface } from './dashboard-structure-surface-state.js';

export function DashboardStructureWorkspaceShell({
    guildId,
    pendingSurface,
    failedSurface,
    onNavigateSurface,
    activeRun,
    executionProgressIssue,
    executionTransport,
    children,
}: {
    guildId: string;
    pendingSurface?: DashboardStructureSurface;
    failedSurface?: DashboardStructureSurface;
    onNavigateSurface?: (surface: DashboardStructureSurface) => Promise<void>;
    activeRun?: Pick<DashboardStructureImportRun, 'id' | 'execution'>;
    executionProgressIssue?: { code: string; runId: string };
    executionTransport: DashboardStructureProgressTransport;
    children: ReactNode;
}) {
    const activeExecution = activeRun?.execution ? (
        <BlueprintExecutionStrip
            key={activeRun.id}
            guildId={guildId}
            run={activeRun}
            hasProgressIssue={executionProgressIssue?.runId === activeRun.id}
            transport={executionTransport}
        />
    ) : undefined;

    return (
        <DashboardFeaturePage
            title={dashboardStructureIdentity.title}
            description={dashboardStructureIdentity.description}
            eyebrow={dashboardStructureIdentity.eyebrow}
            icon={<GitBranch className='size-5' aria-hidden='true' />}
            titleId='server-blueprint-title'
            width='full'
            surface='glass'
            navigation={
                <DashboardStructureNavigation
                    guildId={guildId}
                    pendingSurface={pendingSurface}
                    onNavigateSurface={onNavigateSurface}
                />
            }
            status={activeExecution ? <AnimatePresence initial={false}>{activeExecution}</AnimatePresence> : undefined}>
            {failedSurface ? (
                <DashboardStructurePendingSurface
                    surface={failedSurface}
                    error={{
                        diagnosticCode: 'BLUEPRINT_ROUTE_LOAD_FAILED',
                        retry: () => void onNavigateSurface?.(failedSurface),
                    }}
                />
            ) : pendingSurface ? (
                <DashboardStructurePendingSurface surface={pendingSurface} />
            ) : (
                children
            )}
        </DashboardFeaturePage>
    );
}

export function DashboardStructureNavigation({
    guildId,
    pendingSurface,
    onNavigateSurface,
}: {
    guildId: string;
    pendingSurface?: DashboardStructureSurface;
    onNavigateSurface?: (surface: DashboardStructureSurface) => Promise<void>;
}) {
    return (
        <nav
            className='flex min-w-0 gap-6 overflow-x-auto border-b border-[var(--dash-border)]'
            aria-label='Server Blueprint tools'>
            {dashboardStructureNavigationItems.map((item) => (
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

function BlueprintExecutionStrip({
    guildId,
    run,
    hasProgressIssue,
    transport,
}: {
    guildId: string;
    run: Pick<DashboardStructureImportRun, 'id' | 'execution'>;
    hasProgressIssue: boolean;
    transport: DashboardStructureProgressTransport;
}) {
    const execution = run.execution;
    if (!execution) return null;

    const progress = execution.totalActions > 0 ? execution.completedActions / execution.totalActions : 0;
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
                    <span className='text-[var(--dash-text-muted)]'>
                        {formatDashboardStructureExecutionState(execution)}
                    </span>
                    {execution.currentActionLabel ? (
                        <span className='max-w-full truncate text-[var(--dash-text-subtle)]'>
                            · {execution.currentActionLabel}
                        </span>
                    ) : null}
                </div>
                <p className={getTransportClassName(transport.mode, hasProgressIssue)}>
                    {formatTransportLabel(transport.mode)}
                    {transport.confirmedAt ? ` · confirmed ${formatExecutionTimestamp(transport.confirmedAt)}` : ''}
                </p>
            </div>
            <div className='min-w-0'>
                <div className='mb-1 flex justify-between gap-3 text-[11px] text-[var(--dash-text-subtle)]'>
                    <span>{percent}%</span>
                    <span>
                        {execution.completedActions}/{execution.totalActions} steps
                    </span>
                </div>
                <progress
                    className='sr-only'
                    value={execution.completedActions}
                    max={Math.max(1, execution.totalActions)}
                    aria-label={`${formatDashboardStructureExecutionPhase(execution.phase)}: ${percent}%`}
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
                    to='/dashboard/$guildId/structure/deploy'
                    params={{ guildId }}
                    className='rounded-sm text-[var(--dash-primary)] outline-none hover:text-[var(--dash-primary-strong)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    Open deployment
                </Link>
                <Link
                    to='/dashboard/$guildId/structure/runs'
                    params={{ guildId }}
                    className='rounded-sm text-[var(--dash-text-muted)] outline-none hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    Runs
                </Link>
            </div>
        </motion.div>
    );
}

function formatExecutionTimestamp(value: number | string): string {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatTransportLabel(mode: DashboardStructureProgressTransport['mode']): string {
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

function getTransportClassName(mode: DashboardStructureProgressTransport['mode'], hasProgressIssue: boolean): string {
    return mode === 'live' && !hasProgressIssue
        ? 'mt-1 text-xs text-[var(--dash-success)]'
        : mode === 'polling' && !hasProgressIssue
          ? 'mt-1 text-xs text-[var(--dash-text-muted)]'
          : 'mt-1 text-xs text-[var(--dash-warning)]';
}
