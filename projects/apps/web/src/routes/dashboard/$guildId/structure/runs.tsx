import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/runs');

export const Route = createRoute({
    component: DashboardStructureRunsRoute,
});

function DashboardStructureRunsRoute() {
    return <DashboardStructureRouteSurface surface='runs' />;
}
