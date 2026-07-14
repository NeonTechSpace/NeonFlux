import { createFileRoute } from '@tanstack/react-router';

import { DashboardBlueprintDeployRoute } from '../../../../components/dashboard-blueprint-deploy-route.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/deploy')({
    component: DashboardBlueprintDeployRoute,
});
