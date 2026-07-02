import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommunitySuggestionsCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/suggestions');

export const Route = createRoute({
    component: DashboardCommunitySuggestionsRoute,
});

function DashboardCommunitySuggestionsRoute() {
    return <DashboardGuildCommunitySuggestionsCategory />;
}
