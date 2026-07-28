import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildReactionRolesRoute } from '../../../../components/dashboard-guild-reaction-roles-route.js';

export const Route = createFileRoute('/dashboard/$guildId/messaging/reaction-roles')({
    component: DashboardGuildReactionRolesRoute,
});
