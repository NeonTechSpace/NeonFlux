import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/general')({
    component: DashboardGeneralRoute,
});

function DashboardGeneralRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='general' guildId={getGuildIdParam(params)} />;
}
