import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildCommandPrefixCategory } from '../../../../components/dashboard-guild-page.js';
import {
    getGuildIdParam,
    readDashboardCommandSettingsRouteData,
} from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/general/command-prefix');

export const Route = createRoute({
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
