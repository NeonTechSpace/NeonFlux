import { createFileRoute, redirect } from '@tanstack/react-router';

import { getDefaultDashboardBlueprintTo } from '../../../../dashboard-blueprint-navigation.js';
import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: getDefaultDashboardBlueprintTo(),
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
