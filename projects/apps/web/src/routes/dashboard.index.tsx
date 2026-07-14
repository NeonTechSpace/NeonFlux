import { createFileRoute } from '@tanstack/react-router';

import { DashboardPageContent } from '../components/dashboard-index-page.js';
import { DashboardLauncherError, DashboardLauncherPending } from '../components/dashboard-launcher-pending.js';
import { loadDashboardRouteData } from '../server/dashboard-route-data.js';

export const Route = createFileRoute('/dashboard/')({
    loader: () => loadDashboardRouteData(),
    pendingComponent: DashboardLauncherPending,
    errorComponent: DashboardLauncherRouteError,
    component: DashboardPage,
});

function DashboardLauncherRouteError({ reset }: { reset: () => void }) {
    return <DashboardLauncherError onRetry={reset} />;
}

function DashboardPage() {
    const data = Route.useLoaderData();

    return <DashboardPageContent data={data} />;
}
