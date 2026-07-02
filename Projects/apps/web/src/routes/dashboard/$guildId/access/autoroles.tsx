import { createFileRoute } from '@tanstack/react-router';

import { DashboardAutorolePanel } from '../../../../components/dashboard-autorole-panel.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/autoroles');

export const Route = createRoute({
    component: DashboardAutorolesRoute,
});

function DashboardAutorolesRoute() {
    const params = Route.useParams();

    return <DashboardAutorolePanel guildId={getGuildIdParam(params)} />;
}
