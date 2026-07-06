import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildReactionRolesCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/reaction-roles');

export const Route = createRoute({
    component: DashboardGuildReactionRolesCategory,
});
