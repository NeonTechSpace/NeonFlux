import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildPlannedCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/moderation');

export const Route = createRoute({
    component: DashboardGuildModerationRoute,
});

function DashboardGuildModerationRoute() {
    return <DashboardGuildPlannedCategory categoryId='moderation' />;
}
