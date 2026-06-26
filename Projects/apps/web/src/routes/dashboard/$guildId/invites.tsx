import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildInviteTrackingCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/invites');

export const Route = createRoute({
    component: DashboardGuildInvitesRoute,
});

function DashboardGuildInvitesRoute() {
    return <DashboardGuildInviteTrackingCategory />;
}
