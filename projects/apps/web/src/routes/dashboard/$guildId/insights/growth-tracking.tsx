import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/insights/growth-tracking');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='insights' itemId='growth-tracking' />,
});
