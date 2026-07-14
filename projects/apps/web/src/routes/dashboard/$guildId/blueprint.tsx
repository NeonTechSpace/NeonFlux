import { createFileRoute, useLocation } from '@tanstack/react-router';

import { DashboardBlueprintErrorState } from '../../../components/dashboard-blueprint-error-boundary.js';
import { DashboardBlueprintRuntime } from '../../../components/dashboard-blueprint-runtime.js';
import { DashboardBlueprintWorkspaceShell } from '../../../components/dashboard-blueprint-workspace-shell.js';
import { readDashboardBlueprintSurfaceFromPathname } from '../../../dashboard-blueprint-navigation.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint')({
    pendingComponent: DashboardBlueprintPendingRoute,
    errorComponent: DashboardBlueprintRouteError,
    component: DashboardBlueprintRoute,
});

function DashboardBlueprintRoute() {
    const params = Route.useParams();
    const guildId = getGuildIdParam(params);

    return <DashboardBlueprintRuntime key={guildId} guildId={guildId} />;
}

function DashboardBlueprintPendingRoute() {
    const guildId = getGuildIdParam(Route.useParams());
    const location = useLocation();
    const pendingSurface = readDashboardBlueprintSurfaceFromPathname(location.pathname) ?? 'current';

    return (
        <DashboardBlueprintWorkspaceShell
            guildId={guildId}
            pendingSurface={pendingSurface}
            runTransport={{ mode: 'idle' }}>
            {null}
        </DashboardBlueprintWorkspaceShell>
    );
}

function DashboardBlueprintRouteError({ reset }: { reset: () => void }) {
    const guildId = getGuildIdParam(Route.useParams());

    return (
        <DashboardBlueprintWorkspaceShell guildId={guildId} runTransport={{ mode: 'idle' }}>
            <DashboardBlueprintErrorState
                title='Server Blueprint could not open'
                message='The requested Blueprint tool did not load. Retrying does not start a deployment action.'
                diagnosticCode='BLUEPRINT_ROUTE_LOAD_FAILED'
                onRetry={reset}
            />
        </DashboardBlueprintWorkspaceShell>
    );
}
