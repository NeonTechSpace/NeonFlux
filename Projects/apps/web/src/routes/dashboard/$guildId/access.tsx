import { createFileRoute } from '@tanstack/react-router';

import { DashboardAccessWorkbench } from '../../../components/dashboard-access-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access');

export const Route = createRoute({
    component: DashboardGuildAccessRoute,
});

function DashboardGuildAccessRoute() {
    const params = Route.useParams();

    return <DashboardAccessWorkbench guildId={getGuildIdParam(params)} />;
}
