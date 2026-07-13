import { createFileRoute, redirect } from '@tanstack/react-router';

import { getRequiredDefaultDashboardSubNavigationTo } from '../../../../dashboard-categories.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/moderation/')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getRequiredDefaultDashboardSubNavigationTo('moderation'),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
