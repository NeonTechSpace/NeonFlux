import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/messaging/free-game-alerts');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='messaging' itemId='free-game-alerts' />,
});
