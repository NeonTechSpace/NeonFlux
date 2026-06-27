import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community');

export const Route = createRoute({
    component: DashboardGuildCommunityRoute,
});

function DashboardGuildCommunityRoute() {
    return <DashboardGuildCommunityCategory />;
}
