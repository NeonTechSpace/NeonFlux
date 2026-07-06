import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access');

export const Route = createRoute({
    component: DashboardAccessRoute,
});

function DashboardAccessRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='access' guildId={getGuildIdParam(params)} />;
}
