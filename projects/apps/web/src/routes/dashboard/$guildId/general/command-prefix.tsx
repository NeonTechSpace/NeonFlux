import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommandPrefixCategory } from '../../../../components/dashboard-guild-page.js';
import {
    getGuildIdParam,
    readDashboardCommandSettingsRouteData,
} from '../../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/general/command-prefix')({
    loader: ({ params }) =>
        readDashboardCommandSettingsRouteData({
            data: {
                guildId: getGuildIdParam(params),
            },
        }),
    component: DashboardGuildCommandPrefixRoute,
});

function DashboardGuildCommandPrefixRoute() {
    return <DashboardGuildCommandPrefixCategory commandSettingsResult={Route.useLoaderData()} />;
}
