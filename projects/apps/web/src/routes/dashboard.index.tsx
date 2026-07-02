import { createFileRoute } from '@tanstack/react-router';

import { DashboardPageContent } from '../components/dashboard-index-page.js';
import { loadDashboardRouteData } from '../server/dashboard-route-data.js';

const createRoute = createFileRoute('/dashboard/');

export const Route = createRoute({
    loader: () => loadDashboardRouteData(),
    component: DashboardPage,
});

function DashboardPage() {
    const data = Route.useLoaderData();

    return <DashboardPageContent data={data} />;
}
