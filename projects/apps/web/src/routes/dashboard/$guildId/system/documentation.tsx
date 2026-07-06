import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/system/documentation');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='documentation' />,
});
