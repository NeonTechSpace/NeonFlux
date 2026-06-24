import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import { DashboardRouteLoading } from '../components/dashboard-loading.js';
import { getGuildIdParam, loadDashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId');
const DashboardGuildPageContent = lazy(async () => {
    const module = await import('../components/dashboard-guild-page.js');

    return { default: module.DashboardGuildPageContent };
});

export const Route = createRoute({
    loader: ({ params }) => loadDashboardGuildRouteData({ data: { guildId: getGuildIdParam(params) } }),
    pendingComponent: DashboardRouteLoading,
    component: DashboardGuildPage,
});

function DashboardGuildPage() {
    const data = Route.useLoaderData();

    return (
        <Suspense fallback={<DashboardRouteLoading />}>
            <DashboardGuildPageContent data={data} />
        </Suspense>
    );
}
