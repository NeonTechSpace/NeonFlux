import { createFileRoute, redirect } from '@tanstack/react-router';

import { getDefaultDashboardStructureTo } from '../../../../dashboard-structure-navigation.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getDefaultDashboardStructureTo(),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
