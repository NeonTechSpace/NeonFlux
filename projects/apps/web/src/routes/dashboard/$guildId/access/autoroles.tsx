import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/autoroles');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='access' itemId='autoroles' />,
});
