import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/insights')({
    component: DashboardInsightsRoute,
});

function DashboardInsightsRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='insights' guildId={getGuildIdParam(params)} />;
}
