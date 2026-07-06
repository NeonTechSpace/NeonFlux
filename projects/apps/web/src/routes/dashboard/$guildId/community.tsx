import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/community');

export const Route = createRoute({
    component: DashboardCommunityRoute,
});

function DashboardCommunityRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='community' guildId={getGuildIdParam(params)} />;
}
