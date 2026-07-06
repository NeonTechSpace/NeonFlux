import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/system/public-web-links');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='public-web-links' />,
});
