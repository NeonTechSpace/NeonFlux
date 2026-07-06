import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/general/command-help');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='general' itemId='command-help' />,
});
