import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityTicketsCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/tickets');

export const Route = createRoute({
    component: DashboardCommunityTicketsRoute,
});

function DashboardCommunityTicketsRoute() {
    return <DashboardGuildCommunityTicketsCategory />;
}
