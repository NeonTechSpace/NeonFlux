import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/events')({
    component: DashboardEventsRoute,
});

function DashboardEventsRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='events' guildId={getGuildIdParam(params)} />;
}
