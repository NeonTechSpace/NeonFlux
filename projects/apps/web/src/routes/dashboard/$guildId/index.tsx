import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildOverviewCategory } from '../../../components/dashboard-guild-page.js';

export const Route = createFileRoute('/dashboard/$guildId/')({
    component: DashboardGuildOverviewRoute,
});

function DashboardGuildOverviewRoute() {
    return <DashboardGuildOverviewCategory />;
}
