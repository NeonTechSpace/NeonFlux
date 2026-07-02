import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunityProfileBuilderCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/profile-builder');

export const Route = createRoute({
    component: DashboardCommunityProfileBuilderRoute,
});

function DashboardCommunityProfileBuilderRoute() {
    return <DashboardGuildCommunityProfileBuilderCategory />;
}
