import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/access/autoroles')({
    component: () => <DashboardPlaceholderRoute categoryId='access' itemId='autoroles' />,
});
