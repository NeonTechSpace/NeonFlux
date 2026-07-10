import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureWorkspace } from '../../../components/dashboard-structure-panel.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure');

export const Route = createRoute({
    component: DashboardStructureRoute,
});

function DashboardStructureRoute() {
    const params = Route.useParams();

    return <DashboardStructureWorkspace guildId={getGuildIdParam(params)} />;
}
