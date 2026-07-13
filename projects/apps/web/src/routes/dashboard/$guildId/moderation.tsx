import { createFileRoute } from '@tanstack/react-router';

import { DashboardWorkbench } from '../../../components/dashboard-workbench.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/moderation')({
    component: DashboardModerationRoute,
});

function DashboardModerationRoute() {
    const params = Route.useParams();

    return <DashboardWorkbench categoryId='moderation' guildId={getGuildIdParam(params)} />;
}
