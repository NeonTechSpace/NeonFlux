import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/community')({
    component: DashboardCommunityRoute,
});

function DashboardCommunityRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='community' guildId={getGuildIdParam(params)} />;
}
