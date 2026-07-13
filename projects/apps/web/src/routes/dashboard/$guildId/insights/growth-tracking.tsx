import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/insights/growth-tracking')({
    component: () => <DashboardPlaceholderRoute categoryId='insights' itemId='growth-tracking' />,
});
