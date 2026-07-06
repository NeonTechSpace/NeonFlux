import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/events/logging-destinations');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='events' itemId='logging-destinations' />,
});
