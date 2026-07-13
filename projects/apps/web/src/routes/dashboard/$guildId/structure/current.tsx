import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/current')({
    component: DashboardStructureCurrentRoute,
});

function DashboardStructureCurrentRoute() {
    return <DashboardStructureRouteSurface surface='current' />;
}
