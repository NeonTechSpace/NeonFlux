import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildOverviewRoute } from '../../../components/dashboard-guild-overview-route.js';

export const Route = createFileRoute('/dashboard/$guildId/')({
    component: DashboardGuildOverviewRoute,
});
