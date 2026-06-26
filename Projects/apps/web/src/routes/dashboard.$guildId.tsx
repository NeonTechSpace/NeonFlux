import { createFileRoute, useLocation } from '@tanstack/react-router';

import { DashboardGuildPageContent, DashboardGuildPendingPage } from '../components/dashboard-guild-page.js';
import { getDashboardCategoryIdFromPathname } from '../dashboard-categories.js';
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
    const params = Route.useParams();
    const pathname = useLocation({ select: (location) => location.pathname });
    const guildId = getGuildIdParam(params);
    const activeCategoryId = getDashboardCategoryIdFromPathname(guildId, pathname);

    return <DashboardGuildPageContent data={data} activeCategoryId={activeCategoryId} />;
}

function DashboardGuildPendingRoute() {
    const params = Route.useParams();
    const location = useLocation();
    const guildId = getGuildIdParam(params);
    const activeCategoryId = getDashboardCategoryIdFromPathname(guildId, location.pathname);
    const preview = readDashboardGuildPreview(location.state, guildId);

    return <DashboardGuildPendingPage guildId={guildId} preview={preview} activeCategoryId={activeCategoryId} />;
}
