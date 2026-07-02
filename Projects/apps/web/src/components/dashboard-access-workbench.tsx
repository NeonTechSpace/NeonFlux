import { Link, Outlet, useLocation } from '@tanstack/react-router';
import {
    BadgeCheck,
    Bot,
    GitCompareArrows,
    KeyRound,
    ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';

export type DashboardAccessToolId =
    | 'autoroles'
    | 'reaction-roles'
    | 'verification'
    | 'role-reconciliation'
    | 'command-access';

type DashboardAccessTool = {
    id: DashboardAccessToolId;
    label: string;
    shortLabel: string;
    description: string;
    to: DashboardAccessToolTo;
    icon: LucideIcon;
};

type DashboardAccessToolTo =
    | '/dashboard/$guildId/access/autoroles'
    | '/dashboard/$guildId/access/reaction-roles'
    | '/dashboard/$guildId/access/verification'
    | '/dashboard/$guildId/access/role-reconciliation'
    | '/dashboard/$guildId/access/command-access';

export const dashboardAccessTools = [
    {
        id: 'command-access',
        label: 'Command Access',
        shortLabel: 'Commands',
        description: 'Grant guarded bot commands to trusted roles and users.',
        to: '/dashboard/$guildId/access/command-access',
        icon: KeyRound,
    },
    {
        id: 'autoroles',
        label: 'Autoroles',
        shortLabel: 'Autoroles',
        description: 'Assign safe roles to members when they join.',
        to: '/dashboard/$guildId/access/autoroles',
        icon: Bot,
    },
    {
        id: 'reaction-roles',
        label: 'Reaction Roles',
        shortLabel: 'Reactions',
        description: 'Build role menus backed by reactions.',
        to: '/dashboard/$guildId/access/reaction-roles',
        icon: ShieldCheck,
    },
    {
        id: 'verification',
        label: 'Verification',
        shortLabel: 'Verify',
        description: 'Grant verified roles from configured messages.',
        to: '/dashboard/$guildId/access/verification',
        icon: BadgeCheck,
    },
    {
        id: 'role-reconciliation',
        label: 'Role Reconciliation',
        shortLabel: 'Repair',
        description: 'Repair role drift and clean deleted-role references.',
        to: '/dashboard/$guildId/access/role-reconciliation',
        icon: GitCompareArrows,
    },
] as const satisfies readonly DashboardAccessTool[];

export function DashboardAccessWorkbench({ guildId, children }: { guildId: string; children?: ReactNode }) {
    const pathname = useLocation({ select: (location) => location.pathname });
    const activeToolId = getDashboardAccessToolIdFromPathname(guildId, pathname);
    const activeTool = getDashboardAccessTool(activeToolId);
    const ActiveToolIcon = activeTool.icon;

    return (
        <section className='overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] shadow-[var(--dash-shadow-surface)]'>
            <div className='border-b border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-4 py-4 sm:px-5'>
                <p className='text-xs font-semibold tracking-wide text-[var(--dash-primary)] uppercase'>
                    Roles & Access
                </p>
                <div className='mt-2 flex flex-wrap items-end justify-between gap-3'>
                    <div>
                        <h2 className='text-2xl font-semibold text-[var(--dash-text)]'>Access workbench</h2>
                        <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                            Manage who gets roles automatically, who can verify, and who can run guarded bot commands.
                        </p>
                    </div>
                    <span className='rounded-full border border-[var(--dash-border)] bg-[var(--dash-primary-soft)] px-3 py-1 text-xs font-semibold text-sky-100'>
                        {dashboardAccessTools.length} tools
                    </span>
                </div>
            </div>
            <div className='grid min-h-[36rem] lg:grid-cols-[17rem_minmax(0,1fr)]'>
                <DashboardAccessToolNavigation guildId={guildId} activeToolId={activeToolId} />
                <motion.div
                    key={activeToolId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className='min-w-0 border-t border-[var(--dash-border)] bg-[var(--dash-bg-elevated)] lg:border-t-0 lg:border-l'>
                    <header className='border-b border-[var(--dash-border)] px-4 py-4 sm:px-6'>
                        <div className='flex flex-wrap items-start justify-between gap-3'>
                            <div>
                                <h3 className='text-xl font-semibold text-[var(--dash-text)]'>{activeTool.label}</h3>
                                <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                                    {activeTool.description}
                                </p>
                            </div>
                            <ActiveToolIcon className='size-5 text-[var(--dash-primary)]' aria-hidden='true' />
                        </div>
                    </header>
                    <div className='p-4 sm:p-6'>{children ?? <Outlet />}</div>
                </motion.div>
            </div>
        </section>
    );
}

function DashboardAccessToolNavigation({
    guildId,
    activeToolId,
}: {
    guildId: string;
    activeToolId: DashboardAccessToolId;
}) {
    return (
        <nav className='bg-[var(--dash-surface)] p-2' aria-label='Access tools'>
            <ul className='space-y-1'>
                {dashboardAccessTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.id === activeToolId;

                    return (
                        <li key={tool.id}>
                            <Link
                                to={tool.to}
                                params={{ guildId }}
                                aria-current={active ? 'page' : undefined}
                                className={
                                    active
                                        ? 'flex min-h-12 items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] bg-[var(--dash-surface-selected)] px-3 text-sm font-semibold text-[var(--dash-text)] shadow-[var(--dash-shadow-focus)]'
                                        : 'flex min-h-12 items-center gap-3 rounded-[var(--dash-radius-control)] border border-transparent px-3 text-sm font-semibold text-[var(--dash-text-muted)] transition hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:outline-none'
                                }>
                                <Icon className='size-4 shrink-0' aria-hidden='true' />
                                <span className='min-w-0 truncate'>{tool.shortLabel}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

export function getDashboardAccessTool(id: DashboardAccessToolId): DashboardAccessTool {
    const tool = dashboardAccessTools.find((candidate) => candidate.id === id);

    if (!tool) {
        throw new Error(`Unknown dashboard access tool: ${id}`);
    }

    return tool;
}

export function getDashboardAccessToolIdFromPathname(guildId: string, pathname: string): DashboardAccessToolId {
    const guildIdParam = getGuildIdParam({ guildId });
    const accessPrefix = `/dashboard/${guildIdParam}/access`;
    const segment = pathname.slice(accessPrefix.length + 1).split('/').at(0);

    if (isDashboardAccessToolId(segment)) {
        return segment;
    }

    return 'command-access';
}

function isDashboardAccessToolId(value: unknown): value is DashboardAccessToolId {
    return dashboardAccessTools.some((tool) => tool.id === value);
}
