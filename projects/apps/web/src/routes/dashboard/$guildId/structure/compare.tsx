import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/compare');

export const Route = createRoute({
    component: DashboardStructureCompareRoute,
});

function DashboardStructureCompareRoute() {
    return <DashboardStructureRouteSurface surface='compare' />;
}
