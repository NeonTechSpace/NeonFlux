import { createFileRoute } from '@tanstack/react-router';

import { DashboardCommunityWorkbench } from '../../../components/dashboard-community-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/community');

export const Route = createRoute({
    component: DashboardGuildCommunityRoute,
});

function DashboardGuildCommunityRoute() {
    const params = Route.useParams();

    return <DashboardCommunityWorkbench guildId={getGuildIdParam(params)} />;
}
