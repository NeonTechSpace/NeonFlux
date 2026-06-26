import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildPlannedCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure');

export const Route = createRoute({
    component: DashboardGuildStructureRoute,
});

function DashboardGuildStructureRoute() {
    return <DashboardGuildPlannedCategory categoryId='structure' />;
}
