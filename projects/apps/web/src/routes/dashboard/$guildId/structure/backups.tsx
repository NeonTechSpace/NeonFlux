import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRouteSurface } from '../../../../components/dashboard-structure-panel.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/backups')({
    component: DashboardStructureBackupsRoute,
});

function DashboardStructureBackupsRoute() {
    return <DashboardStructureRouteSurface surface='backups' />;
}
