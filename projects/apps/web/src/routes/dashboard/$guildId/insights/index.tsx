import { createFileRoute, redirect } from '@tanstack/react-router';

import { getRequiredDefaultDashboardSubNavigationTo } from '../../../../dashboard-categories.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/insights/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getRequiredDefaultDashboardSubNavigationTo('insights'),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
