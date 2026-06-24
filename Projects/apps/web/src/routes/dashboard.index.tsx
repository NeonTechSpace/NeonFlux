import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import { DashboardRouteLoading } from '../components/dashboard-loading.js';
import { loadDashboardRouteData } from '../server/dashboard-route-data.js';

const createRoute = createFileRoute('/dashboard/');
const DashboardPageContent = lazy(async () => {
    const module = await import('../components/dashboard-index-page.js');

    return { default: module.DashboardPageContent };
});

export const Route = createRoute({
    loader: () => loadDashboardRouteData(),
    pendingComponent: DashboardRouteLoading,
    component: DashboardPage,
});

function DashboardPage() {
    const data = Route.useLoaderData();

    return (
        <Suspense fallback={<DashboardRouteLoading />}>
            <DashboardPageContent data={data} />
        </Suspense>
    );
}
