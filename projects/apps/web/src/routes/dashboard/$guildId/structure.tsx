import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildStructureCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure');

export const Route = createRoute({
    component: DashboardGuildStructureRoute,
});

function DashboardGuildStructureRoute() {
    return <DashboardGuildStructureCategory />;
}
