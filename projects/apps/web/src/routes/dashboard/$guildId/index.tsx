import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildOverviewCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/');

export const Route = createRoute({
    component: DashboardGuildOverviewRoute,
});

function DashboardGuildOverviewRoute() {
    return <DashboardGuildOverviewCategory />;
}
