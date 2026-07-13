import { createFileRoute } from '@tanstack/react-router';

import { DashboardPageContent } from '../components/dashboard-index-page.js';
import { loadDashboardRouteData } from '../server/dashboard-route-data.js';

export const Route = createFileRoute('/dashboard/')({
    loader: () => loadDashboardRouteData(),
    component: DashboardPage,
});

function DashboardPage() {
    const data = Route.useLoaderData();

    return <DashboardPageContent data={data} />;
}
