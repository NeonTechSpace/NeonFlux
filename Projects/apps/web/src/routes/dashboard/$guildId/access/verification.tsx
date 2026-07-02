import { createFileRoute } from '@tanstack/react-router';

import { DashboardVerificationPanel } from '../../../../components/dashboard-verification-panel.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/verification');

export const Route = createRoute({
    component: DashboardVerificationRoute,
});

function DashboardVerificationRoute() {
    const params = Route.useParams();

    return <DashboardVerificationPanel guildId={getGuildIdParam(params)} />;
}
