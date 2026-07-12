import { Link, useParams } from '@tanstack/react-router';

import { dashboardNavigationEntries, getDashboardSubNavigationItem } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { getGuildIdParam } from '../server/dashboard-guild-route-data.js';
import { DashboardFeaturePlaceholder } from './dashboard-feature-placeholder.js';
import { dashboardSecondaryActionClassName } from './dashboard-ui.js';

export function DashboardPlaceholderRoute({ categoryId, itemId }: { categoryId: DashboardCategoryId; itemId: string }) {
    const item = getDashboardSubNavigationItem(categoryId, itemId);
    const guildId = getGuildIdParam(useParams({ strict: false }));
    const relatedEntry = dashboardNavigationEntries.find((entry) => entry.category.id === item.navigationJobId);

    return (
        <DashboardFeaturePlaceholder
            action={
                relatedEntry ? (
                    <Link
                        to={relatedEntry.linkTo}
                        params={{ guildId }}
                        className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                        Open {relatedEntry.category.label}
                    </Link>
                ) : (
                    <Link
                        to='/dashboard/$guildId'
                        params={{ guildId }}
                        className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                        Back to overview
                    </Link>
                )
            }
        />
    );
}
