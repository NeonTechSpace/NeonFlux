import { createFileRoute } from '@tanstack/react-router';

import { DashboardBlueprintCurrentRoute } from '../../../../components/dashboard-blueprint-current-route.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/current')({
    component: DashboardBlueprintCurrentRoute,
});
