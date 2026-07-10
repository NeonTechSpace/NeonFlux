import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/backups');

export const Route = createRoute({
    component: DashboardStructureBackupsRoute,
});

function DashboardStructureBackupsRoute() {
    return <DashboardStructureRouteSurface surface='backups' />;
}
