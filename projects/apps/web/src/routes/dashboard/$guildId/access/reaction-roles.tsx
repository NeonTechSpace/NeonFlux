import { createFileRoute } from '@tanstack/react-router';

import { DashboardReactionRolesPanel } from '../../../../components/dashboard-reaction-roles-panel.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/reaction-roles');

export const Route = createRoute({
    component: DashboardReactionRolesRoute,
});

function DashboardReactionRolesRoute() {
    const params = Route.useParams();

    return <DashboardReactionRolesPanel guildId={getGuildIdParam(params)} />;
}
