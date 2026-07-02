import { Outlet, useLocation } from '@tanstack/react-router';
import { Gift, Lightbulb, TicketCheck, Trophy, UserRoundCog, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';

export type DashboardCommunityToolId =
    | 'xp'
    | 'giveaways'
    | 'profile-builder'
    | 'vc-generator'
    | 'tickets'
    | 'suggestions';

type DashboardCommunityTool = {
    id: DashboardCommunityToolId;
    label: string;
    shortLabel: string;
    description: string;
    to: DashboardCommunityToolTo;
    icon: LucideIcon;
};

type DashboardCommunityToolTo =
    | '/dashboard/$guildId/community/xp'
    | '/dashboard/$guildId/community/giveaways'
    | '/dashboard/$guildId/community/profile-builder'
    | '/dashboard/$guildId/community/vc-generator'
    | '/dashboard/$guildId/community/tickets'
    | '/dashboard/$guildId/community/suggestions';

export const dashboardCommunityTools = [
    {
        id: 'xp',
        label: 'XP Rules',
        shortLabel: 'XP',
        description: 'Tune message and voice XP rules without leaving the community workflow.',
        to: '/dashboard/$guildId/community/xp',
        icon: Trophy,
    },
    {
        id: 'giveaways',
        label: 'Giveaways',
        shortLabel: 'Giveaways',
        description: 'Build, publish, and resolve giveaway events from one operational surface.',
        to: '/dashboard/$guildId/community/giveaways',
        icon: Gift,
    },
    {
        id: 'profile-builder',
        label: 'Profile Builder',
        shortLabel: 'Profiles',
        description: 'Shape public profile forms and review community submissions.',
        to: '/dashboard/$guildId/community/profile-builder',
        icon: UserRoundCog,
    },
    {
        id: 'vc-generator',
        label: 'Voice Rooms',
        shortLabel: 'Voice',
        description: 'Configure join-to-create voice rooms and their publish state.',
        to: '/dashboard/$guildId/community/vc-generator',
        icon: Volume2,
    },
    {
        id: 'tickets',
        label: 'Tickets',
        shortLabel: 'Tickets',
        description: 'Manage ticket panels, staff roles, and private support flows.',
        to: '/dashboard/$guildId/community/tickets',
        icon: TicketCheck,
    },
    {
        id: 'suggestions',
        label: 'Suggestions',
        shortLabel: 'Ideas',
        description: 'Route member ideas into structured suggestion boards.',
        to: '/dashboard/$guildId/community/suggestions',
        icon: Lightbulb,
    },
] as const satisfies readonly DashboardCommunityTool[];

export function DashboardCommunityWorkbench({ guildId, children }: { guildId: string; children?: ReactNode }) {
    const pathname = useLocation({ select: (location) => location.pathname });
    const activeToolId = getDashboardCommunityToolIdFromPathname(guildId, pathname);
    const activeTool = getDashboardCommunityTool(activeToolId);

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

export function getDashboardCommunityTool(id: DashboardCommunityToolId): DashboardCommunityTool {
    const tool = dashboardCommunityTools.find((candidate) => candidate.id === id);

    if (!tool) {
        throw new Error(`Unknown dashboard community tool: ${id}`);
    }

    return tool;
}

export function getDashboardCommunityToolIdFromPathname(guildId: string, pathname: string): DashboardCommunityToolId {
    const guildIdParam = getGuildIdParam({ guildId });
    const communityPrefix = `/dashboard/${guildIdParam}/community`;
    const segment = pathname
        .slice(communityPrefix.length + 1)
        .split('/')
        .at(0);

    if (isDashboardCommunityToolId(segment)) {
        return segment;
    }

    return 'xp';
}

function isDashboardCommunityToolId(value: unknown): value is DashboardCommunityToolId {
    return dashboardCommunityTools.some((tool) => tool.id === value);
}
