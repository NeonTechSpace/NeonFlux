import { createFileRoute } from '@tanstack/react-router';

import { DashboardRoleReconciliationPanel } from '../../../../components/dashboard-role-reconciliation-panel.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/role-reconciliation');

export const Route = createRoute({
    component: DashboardRoleReconciliationRoute,
});

function DashboardRoleReconciliationRoute() {
    const params = Route.useParams();

    return <DashboardRoleReconciliationPanel guildId={getGuildIdParam(params)} />;
}
