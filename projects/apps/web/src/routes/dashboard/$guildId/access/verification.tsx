import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/verification');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='access' itemId='verification' />,
});
