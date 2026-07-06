import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/general/bot-presence');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='general' itemId='bot-presence' />,
});
