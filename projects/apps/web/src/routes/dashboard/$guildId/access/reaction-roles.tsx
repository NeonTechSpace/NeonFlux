import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildReactionRolesCategory } from '../../../../components/dashboard-guild-page.js';

export const Route = createFileRoute('/dashboard/$guildId/access/reaction-roles')({
    component: DashboardGuildReactionRolesCategory,
});
