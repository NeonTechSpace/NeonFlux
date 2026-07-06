import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/system/convex-dashboard-data');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='convex-dashboard-data' />,
});
