import { createFileRoute, useLocation } from '@tanstack/react-router';

import { DashboardStructureErrorState } from '../../../components/dashboard-structure-error-boundary.js';
import { DashboardStructureRuntime } from '../../../components/dashboard-structure-runtime.js';
import { DashboardStructureWorkspaceShell } from '../../../components/dashboard-structure-workspace-shell.js';
import { readDashboardStructureSurfaceFromPathname } from '../../../dashboard-structure-navigation.js';
import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/structure')({
    pendingComponent: DashboardStructurePendingRoute,
    errorComponent: DashboardStructureRouteError,
    component: DashboardStructureRoute,
});

function DashboardStructureRoute() {
    const params = Route.useParams();
    const guildId = getGuildIdParam(params);

    return <DashboardStructureRuntime key={guildId} guildId={guildId} />;
}

function DashboardStructurePendingRoute() {
    const guildId = getGuildIdParam(Route.useParams());
    const location = useLocation();
    const pendingSurface = readDashboardStructureSurfaceFromPathname(location.pathname) ?? 'current';

    return (
        <DashboardStructureWorkspaceShell
            guildId={guildId}
            pendingSurface={pendingSurface}
            executionTransport={{ mode: 'idle' }}>
            {null}
        </DashboardStructureWorkspaceShell>
    );
}

function DashboardStructureRouteError({ reset }: { reset: () => void }) {
    const guildId = getGuildIdParam(Route.useParams());

    return (
        <DashboardStructureWorkspaceShell guildId={guildId} executionTransport={{ mode: 'idle' }}>
            <DashboardStructureErrorState
                title='Server Blueprint could not open'
                message='The requested Blueprint tool did not load. Retrying does not start a deployment action.'
                diagnosticCode='BLUEPRINT_ROUTE_LOAD_FAILED'
                onRetry={reset}
            />
        </DashboardStructureWorkspaceShell>
    );
}
