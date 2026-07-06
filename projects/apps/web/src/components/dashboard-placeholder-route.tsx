import { getDashboardSubNavigationItem } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { DashboardGuildPlaceholderCategory } from './dashboard-guild-page.js';

export function DashboardPlaceholderRoute({ categoryId, itemId }: { categoryId: DashboardCategoryId; itemId: string }) {
    const item = getDashboardSubNavigationItem(categoryId, itemId);

    return <DashboardGuildPlaceholderCategory featureName={item.label} />;
}
