import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/system/bot-installation-sync');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='bot-installation-sync' />,
});
