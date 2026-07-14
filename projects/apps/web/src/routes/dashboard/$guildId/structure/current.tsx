import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureCurrentRoute } from '../../../../components/dashboard-structure-current-route.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/current')({
    component: DashboardStructureCurrentRoute,
});
