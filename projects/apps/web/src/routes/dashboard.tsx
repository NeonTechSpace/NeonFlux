import { Outlet, createFileRoute } from '@tanstack/react-router';

import { DashboardRouteFrame } from '../components/dashboard-layout.js';

const createRoute = createFileRoute('/dashboard');

const dashboardLayoutRouteOptions = {
    component: DashboardLayout,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardLayoutRouteOptions);

function DashboardLayout() {
    return (
        <DashboardRouteFrame>
            <Outlet />
        </DashboardRouteFrame>
    );
}
