import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/insights/invite-tracker')({
    component: () => <DashboardPlaceholderRoute categoryId='insights' itemId='invite-tracker' />,
});
