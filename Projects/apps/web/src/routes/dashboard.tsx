import { Outlet, createFileRoute } from '@tanstack/react-router';

const createRoute = createFileRoute('/dashboard');

export const dashboardLayoutRouteOptions = {
    component: DashboardLayout,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardLayoutRouteOptions);

function DashboardLayout() {
    return <Outlet />;
}
