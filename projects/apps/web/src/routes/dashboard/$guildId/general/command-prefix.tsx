import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommandPrefixCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/general/command-prefix');

export const Route = createRoute({
    component: DashboardGuildCommandPrefixCategory,
});
