import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/compare')({
    component: DashboardStructureCompareRoute,
});

function DashboardStructureCompareRoute() {
    return <DashboardStructureRouteSurface surface='compare' />;
}
