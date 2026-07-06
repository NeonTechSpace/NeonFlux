import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/moderation/cases');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='moderation' itemId='cases' />,
});
