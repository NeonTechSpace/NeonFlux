import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/runs')({
    component: DashboardStructureRunsRoute,
});

function DashboardStructureRunsRoute() {
    return <DashboardStructureRouteSurface surface='runs' />;
}
