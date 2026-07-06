import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/giveaways');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='community' itemId='giveaways' />,
});
