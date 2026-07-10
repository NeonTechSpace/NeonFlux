import { createFileRoute, redirect } from '@tanstack/react-router';

import { getDefaultDashboardStructureTo } from '../../../../dashboard-structure-navigation.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/structure/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getDefaultDashboardStructureTo(),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
