import { createFileRoute, useLocation } from '@tanstack/react-router';

import { DashboardGuildPageContent, DashboardGuildPendingPage } from '../components/dashboard-guild-page.js';
import { readDashboardGuildPreview } from '../dashboard-guild-preview.js';
import { getGuildIdParam, loadDashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId');

export const Route = createRoute({
    loader: ({ params }) =>
        loadDashboardGuildRouteData({
            data: {
                guildId: getGuildIdParam(params),
            },
        }),
    pendingComponent: DashboardGuildPendingRoute,
    component: DashboardGuildPage,
});

function DashboardGuildPage() {
    const data = Route.useLoaderData();

    return <DashboardGuildPageContent data={data} />;
}

function DashboardGuildPendingRoute() {
    const params = Route.useParams();
    const locationState = useLocation({ select: (location) => location.state });
    const guildId = getGuildIdParam(params);
    const preview = readDashboardGuildPreview(locationState, guildId);

    return <DashboardGuildPendingPage guildId={guildId} preview={preview} />;
}
