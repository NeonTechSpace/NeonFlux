import { createFileRoute, redirect } from '@tanstack/react-router';

import { getRequiredDefaultDashboardSubNavigationTo } from '../../../../dashboard-categories.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getRequiredDefaultDashboardSubNavigationTo('community'),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
