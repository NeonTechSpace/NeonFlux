import { Outlet, useLocation } from '@tanstack/react-router';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import {
    dashboardCapabilities,
    getDashboardCategory,
    getDashboardCategorySubNavigation,
    getDashboardNavigationJob,
} from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';
import { dashboardContentTransition, dashboardContentVariants } from './dashboard-motion.js';
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
    const navigationJob = activeItem ? getDashboardNavigationJob(activeItem.navigationJobId) : undefined;
    const headingId = `dashboard-${activeId}-heading`;
    const FeatureIcon = activeItem?.icon ?? category.icon;

    return (
        <section className='min-w-0' aria-labelledby={headingId}>
            <motion.div
                key={activeId}
                data-dashboard-motion='route-arrival'
                variants={dashboardContentVariants}
                initial='initial'
                animate='enter'
                transition={dashboardContentTransition}>
                <DashboardPage width={getDashboardWorkbenchWidth(activeId)}>
                    <DashboardPageHeader
                        title={activeItem?.label ?? category.label}
                        description={activeItem?.description ?? category.description}
                        eyebrow={navigationJob?.label}
                        icon={<FeatureIcon className='size-5' aria-hidden='true' />}
                        titleId={headingId}
                    />
                    {children ?? <Outlet />}
                </DashboardPage>
            </motion.div>
        </section>
    );
}

export function getDashboardWorkbenchWidth(activeId: string): 'focused' | 'standard' | 'wide' | 'full' {
    return dashboardCapabilities.find((item) => item.id === activeId)?.pageWidth ?? 'standard';
}

function getDashboardSubNavigationPath(to: string, guildId: string): string {
    return to.replace('$guildId', getGuildIdParam({ guildId }));
}
