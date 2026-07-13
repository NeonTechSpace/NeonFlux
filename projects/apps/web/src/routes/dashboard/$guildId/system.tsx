import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/system')({
    component: DashboardSystemRoute,
});

function DashboardSystemRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='system' guildId={getGuildIdParam(params)} />;
}
