import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/current');

export const Route = createRoute({
    component: DashboardStructureCurrentRoute,
});

function DashboardStructureCurrentRoute() {
    return <DashboardStructureRouteSurface surface='current' />;
}
