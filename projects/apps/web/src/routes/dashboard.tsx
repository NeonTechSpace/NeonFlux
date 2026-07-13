import { Outlet, createFileRoute } from '@tanstack/react-router';

import { DashboardRouteFrame } from '../components/dashboard-layout.js';
import { DashboardLiveProvider } from '../components/dashboard-live-provider.js';

export const Route = createFileRoute('/dashboard')({
    component: DashboardLayout,
});

function DashboardLayout() {
    return (
        <DashboardLiveProvider>
            <DashboardRouteFrame>
                <Outlet />
            </DashboardRouteFrame>
        </DashboardLiveProvider>
    );
}
