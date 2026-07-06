import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/events');

export const Route = createRoute({
    component: DashboardEventsRoute,
});

function DashboardEventsRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='events' guildId={getGuildIdParam(params)} />;
}
