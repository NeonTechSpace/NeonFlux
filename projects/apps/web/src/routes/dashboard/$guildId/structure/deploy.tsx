import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureDeployRoute } from '../../../../components/dashboard-structure-deploy-route.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/deploy')({
    component: DashboardStructureDeployRoute,
});
