import { createFileRoute } from '@tanstack/react-router';

import { getGuildIdParam, redirectDashboardGuildSubrouteFallback } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/$');

export const Route = createRoute({
    loader: async ({ params }) => {
        const guildId = getGuildIdParam(params);
        return redirectDashboardGuildSubrouteFallback(guildId);
    },
    component: () => null,
});
