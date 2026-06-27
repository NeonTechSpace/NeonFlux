import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildLoggingCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/logging');

export const Route = createRoute({
    component: DashboardGuildLoggingRoute,
});

function DashboardGuildLoggingRoute() {
    return <DashboardGuildLoggingCategory />;
}
