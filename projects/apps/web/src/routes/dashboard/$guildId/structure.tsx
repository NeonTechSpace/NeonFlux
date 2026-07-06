import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure');

export const Route = createRoute({
    component: DashboardStructureRoute,
});

function DashboardStructureRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='structure' guildId={getGuildIdParam(params)} />;
}
