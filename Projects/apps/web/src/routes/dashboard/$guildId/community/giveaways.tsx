import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityGiveawaysCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/giveaways');

export const Route = createRoute({
    component: DashboardCommunityGiveawaysRoute,
});

function DashboardCommunityGiveawaysRoute() {
    return <DashboardGuildCommunityGiveawaysCategory />;
}
