import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildAccessCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/access');

export const Route = createRoute({
    component: DashboardGuildAccessRoute,
});

function DashboardGuildAccessRoute() {
    return <DashboardGuildAccessCategory />;
}
