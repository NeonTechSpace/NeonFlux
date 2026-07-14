import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';

import { DashboardLauncherPending } from '../components/dashboard-launcher-pending.js';
import { DashboardRouteFrame } from '../components/dashboard-layout.js';
import { DashboardLiveProvider } from '../components/dashboard-live-provider.js';

export const Route = createFileRoute('/dashboard')({
    component: DashboardLayout,
});

function DashboardLayout() {
    const returningToLauncher = useRouterState({
        select: (state) =>
            state.isLoading &&
            state.location.pathname === '/dashboard' &&
            Boolean(state.resolvedLocation?.pathname.startsWith('/dashboard/')),
    });

    return (
        <DashboardLiveProvider>
            <DashboardRouteFrame>{returningToLauncher ? <DashboardLauncherPending /> : <Outlet />}</DashboardRouteFrame>
        </DashboardLiveProvider>
    );
}
