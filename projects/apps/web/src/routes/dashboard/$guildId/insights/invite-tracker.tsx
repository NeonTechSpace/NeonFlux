import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/insights/invite-tracker');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='insights' itemId='invite-tracker' />,
});
