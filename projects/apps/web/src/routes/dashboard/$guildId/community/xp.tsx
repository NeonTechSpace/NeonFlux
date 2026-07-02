import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityXpCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/xp');

export const Route = createRoute({
    component: DashboardCommunityXpRoute,
});

function DashboardCommunityXpRoute() {
    return <DashboardGuildCommunityXpCategory />;
}
