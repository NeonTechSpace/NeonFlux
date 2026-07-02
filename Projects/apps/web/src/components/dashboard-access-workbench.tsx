import { Outlet, useLocation } from '@tanstack/react-router';
import { BadgeCheck, Bot, GitCompareArrows, KeyRound, ShieldCheck } from 'lucide-react';
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

    return (
        <section className='min-w-0'>
            <motion.div
                key={activeToolId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='min-w-0 space-y-4'>
                <header className='border-b border-[var(--dash-border)] pb-4'>
                    <h2 className='text-2xl font-semibold text-[var(--dash-text)]'>{activeTool.label}</h2>
                    <p className='mt-1 max-w-3xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        {activeTool.description}
                    </p>
                </header>
                {children ?? <Outlet />}
            </motion.div>
        </section>
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
    const segment = pathname
        .slice(accessPrefix.length + 1)
        .split('/')
        .at(0);

    if (isDashboardAccessToolId(segment)) {
        return segment;
    }

    return 'command-access';
}

function isDashboardAccessToolId(value: unknown): value is DashboardAccessToolId {
    return dashboardAccessTools.some((tool) => tool.id === value);
}
