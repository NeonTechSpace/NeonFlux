import { Outlet, useLocation } from '@tanstack/react-router';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { getDashboardCategory, getDashboardCategorySubNavigation } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';
import { DashboardPage, DashboardPageHeader } from './dashboard-ui.js';

export function DashboardWorkbench({
    categoryId,
    guildId,
    children,
}: {
    categoryId: DashboardCategoryId;
    guildId: string;
    children?: ReactNode;
}) {
    const pathname = useLocation({ select: (location) => location.pathname });
    const category = getDashboardCategory(categoryId);
    const activeItem = getDashboardCategorySubNavigation(categoryId).find((item) => {
        const path = getDashboardSubNavigationPath(item.to, guildId);

        return pathname === path || pathname.startsWith(`${path}/`);
    });
    const activeId = activeItem?.id ?? categoryId;
    const headingId = `dashboard-${activeId}-heading`;

    return (
        <section className='min-w-0' aria-labelledby={headingId}>
            <motion.div
                key={activeId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}>
                <DashboardPage width={getWorkbenchWidth(activeId)}>
                    <DashboardPageHeader
                        title={activeItem?.label ?? category.label}
                        description={activeItem?.description ?? category.description}
                        titleId={headingId}
                    />
                    {children ?? <Outlet />}
                </DashboardPage>
            </motion.div>
        </section>
    );
}

function getWorkbenchWidth(activeId: string): 'focused' | 'standard' | 'wide' | 'full' {
    if (activeId === 'command-prefix' || activeId === 'bot-presence' || activeId === 'command-help') {
        return 'focused';
    }

    if (
        activeId === 'audit-events' ||
        activeId === 'message-builder' ||
        activeId === 'reaction-roles' ||
        activeId === 'cases' ||
        activeId === 'tickets'
    ) {
        return 'full';
    }

    return 'standard';
}

function getDashboardSubNavigationPath(to: string, guildId: string): string {
    return to.replace('$guildId', getGuildIdParam({ guildId }));
}
