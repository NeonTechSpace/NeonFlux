import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityVcGeneratorCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/vc-generator');

export const Route = createRoute({
    component: DashboardCommunityVcGeneratorRoute,
});

function DashboardCommunityVcGeneratorRoute() {
    return <DashboardGuildCommunityVcGeneratorCategory />;
}
