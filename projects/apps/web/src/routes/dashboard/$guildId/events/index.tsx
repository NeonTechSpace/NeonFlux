import { createFileRoute, redirect } from '@tanstack/react-router';

import { getRequiredDefaultDashboardSubNavigationTo } from '../../../../dashboard-categories.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/events/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getRequiredDefaultDashboardSubNavigationTo('events'),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
