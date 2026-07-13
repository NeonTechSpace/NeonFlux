import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/moderation/cases')({
    component: () => <DashboardPlaceholderRoute categoryId='moderation' itemId='cases' />,
});
