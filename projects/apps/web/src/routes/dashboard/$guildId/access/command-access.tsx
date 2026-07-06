import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/command-access');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='access' itemId='command-access' />,
});
