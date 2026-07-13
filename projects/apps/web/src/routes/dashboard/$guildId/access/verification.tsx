import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/access/verification')({
    component: () => <DashboardPlaceholderRoute categoryId='access' itemId='verification' />,
});
