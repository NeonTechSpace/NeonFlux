import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/deploy');

export const Route = createRoute({
    component: DashboardStructureDeployRoute,
});

function DashboardStructureDeployRoute() {
    return <DashboardStructureRouteSurface surface='deploy' />;
}
