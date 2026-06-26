import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildPlannedCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/logging');

export const Route = createRoute({
    component: DashboardGuildLoggingRoute,
});

function DashboardGuildLoggingRoute() {
    return <DashboardGuildPlannedCategory categoryId='logging' />;
}
