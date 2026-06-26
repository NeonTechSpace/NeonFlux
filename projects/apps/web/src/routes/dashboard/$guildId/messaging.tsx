import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildMessagingCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/messaging');

export const Route = createRoute({
    component: DashboardGuildMessagingRoute,
});

function DashboardGuildMessagingRoute() {
    return <DashboardGuildMessagingCategory />;
}
