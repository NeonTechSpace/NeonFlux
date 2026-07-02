import { createFileRoute } from '@tanstack/react-router';

import { DashboardCommandAccessPanel } from '../../../../components/dashboard-command-access-panel.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/command-access');

export const Route = createRoute({
    component: DashboardCommandAccessRoute,
});

function DashboardCommandAccessRoute() {
    const params = Route.useParams();

    return <DashboardCommandAccessPanel guildId={getGuildIdParam(params)} />;
}
