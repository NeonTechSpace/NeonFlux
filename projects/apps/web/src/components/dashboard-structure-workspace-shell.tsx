import { Link, Outlet } from '@tanstack/react-router';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import {
    formatDashboardStructureExecutionPhase,
    formatDashboardStructureExecutionState,
} from '../server/dashboard-structure-contracts.js';
import type { DashboardStructureProgressTransport } from './dashboard-structure-execution-progress.js';

const blueprintNavigation = [
    { id: 'current', label: 'Current', to: '/dashboard/$guildId/structure/current' },
    { id: 'backups', label: 'Backups', to: '/dashboard/$guildId/structure/backups' },
    { id: 'compare', label: 'Compare', to: '/dashboard/$guildId/structure/compare' },
    { id: 'deploy', label: 'Deploy', to: '/dashboard/$guildId/structure/deploy' },
    { id: 'runs', label: 'Runs', to: '/dashboard/$guildId/structure/runs' },
] as const;

export function DashboardStructureWorkspaceShell({
    guildId,
    activeRun,
    executionProgressIssue,
    executionTransport,
    children,
}: {
    guildId: string;
    activeRun?: DashboardStructureImportRun;
    executionProgressIssue?: { code: string; runId: string };
    executionTransport: DashboardStructureProgressTransport;
    children: ReactNode;
}) {
    return (
        <section className='min-w-0' aria-labelledby='server-blueprint-title'>
            <header className='sticky top-0 z-10 border-b border-[var(--dash-border)] bg-[rgba(7,8,11,0.94)] px-1 backdrop-blur-md'>
                <div className='flex min-h-14 items-center justify-between gap-5'>
                    <h2
                        id='server-blueprint-title'
                        className='text-xl font-semibold tracking-tight text-[var(--dash-text)]'>
                        Server Blueprint
                    </h2>
                    <p className='hidden text-sm text-[var(--dash-text-muted)] 2xl:block'>
                        Capture versions, understand differences, and apply reviewed changes.
                    </p>
                </div>
                <nav className='flex min-w-0 gap-6 overflow-x-auto' aria-label='Server Blueprint tools'>
                    {blueprintNavigation.map((item) => (
                        <Link
                            key={item.id}
                            to={item.to}
                            params={{ guildId }}
                            className='relative shrink-0 py-3 text-sm font-medium text-[var(--dash-text-muted)] transition-colors hover:text-[var(--dash-text)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)]'
                            activeProps={{ className: 'text-[var(--dash-text)]' }}>
                            {({ isActive }) => (
                                <>
                                    {item.label}
                                    {isActive ? (
                                        <motion.span
                                            layoutId='server-blueprint-active-tool'
                                            className='absolute inset-x-0 bottom-0 h-0.5 bg-[var(--dash-primary)]'
                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                        />
                                    ) : null}
                                </>
                            )}
                        </Link>
                    ))}
                </nav>
                {activeRun?.execution ? (
                    <BlueprintExecutionStrip
                        guildId={guildId}
                        run={activeRun}
                        hasProgressIssue={executionProgressIssue?.runId === activeRun.id}
                        transport={executionTransport}
                    />
                ) : null}
            </header>
            <div className='pt-5'>{children}</div>
        </section>
    );
}

function BlueprintExecutionStrip({
    guildId,
    run,
    hasProgressIssue,
    transport,
}: {
    guildId: string;
    run: DashboardStructureImportRun;
    hasProgressIssue: boolean;
    transport: DashboardStructureProgressTransport;
}) {
    const execution = run.execution;
    if (!execution) return null;

    const progress = execution.totalActions > 0 ? execution.completedActions / execution.totalActions : 0;
    const percent = Math.round(progress * 100);

    return (
        <div
            className='grid min-w-0 gap-2 border-t border-[var(--dash-border)] py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)_auto] md:items-center md:gap-4'
            aria-label='Active Blueprint deployment'>
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
                    className='h-1.5 w-full accent-[var(--dash-primary)]'
                    value={execution.completedActions}
                    max={Math.max(1, execution.totalActions)}
                    aria-label={`${formatDashboardStructureExecutionPhase(execution.phase)}: ${percent}%`}
                />
            </div>
            <div className='flex items-center gap-3 text-xs font-semibold'>
                <Link
                    to='/dashboard/$guildId/structure/deploy'
                    params={{ guildId }}
                    className='text-[var(--dash-primary)] hover:text-[var(--dash-primary-strong)]'>
                    Open deployment
                </Link>
                <Link
                    to='/dashboard/$guildId/structure/runs'
                    params={{ guildId }}
                    className='text-[var(--dash-text-muted)] hover:text-[var(--dash-text)]'>
                    Runs
                </Link>
            </div>
        </div>
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
        ? 'mt-1 text-xs text-emerald-200'
        : mode === 'polling' && !hasProgressIssue
          ? 'mt-1 text-xs text-[var(--dash-text-muted)]'
          : 'mt-1 text-xs text-amber-200';
}

export function DashboardStructureWorkspaceOutlet() {
    return <Outlet />;
}
