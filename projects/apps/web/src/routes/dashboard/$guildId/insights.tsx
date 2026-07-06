import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/insights');

export const Route = createRoute({
    component: DashboardInsightsRoute,
});

function DashboardInsightsRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='insights' guildId={getGuildIdParam(params)} />;
}
