import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/tickets');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='community' itemId='tickets' />,
});
