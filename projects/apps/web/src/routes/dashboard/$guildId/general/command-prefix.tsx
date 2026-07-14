import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommandPrefixRoute } from '../../../../components/dashboard-guild-command-prefix-route.js';

export const Route = createFileRoute('/dashboard/$guildId/general/command-prefix')({
    component: DashboardGuildCommandPrefixRoute,
});
