import { Outlet, useLocation } from '@tanstack/react-router';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { getDashboardCategory, getDashboardCategorySubNavigation } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';

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

    return (
        <section className='min-w-0'>
            <motion.div
                key={activeItem?.id ?? categoryId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='min-w-0 space-y-4'>
                <header className='border-b border-[var(--dash-border)] pb-4'>
                    <h2 className='text-2xl font-semibold text-[var(--dash-text)]'>
                        {activeItem?.label ?? category.label}
                    </h2>
                    <p className='mt-1 max-w-3xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        {activeItem?.description ?? category.description}
                    </p>
                </header>
                {children ?? <Outlet />}
            </motion.div>
        </section>
    );
}

function getDashboardSubNavigationPath(to: string, guildId: string): string {
    return to.replace('$guildId', getGuildIdParam({ guildId }));
}
