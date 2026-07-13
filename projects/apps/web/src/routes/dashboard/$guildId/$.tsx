import { createFileRoute } from '@tanstack/react-router';

import { getGuildIdParam, redirectDashboardGuildSubrouteFallback } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/$')({
    loader: async ({ params }) => {
        const guildId = getGuildIdParam(params);
        return redirectDashboardGuildSubrouteFallback(guildId);
    },
    component: () => null,
});
