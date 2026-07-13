import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/moderation/automod')({
    component: () => <DashboardPlaceholderRoute categoryId='moderation' itemId='automod' />,
});
