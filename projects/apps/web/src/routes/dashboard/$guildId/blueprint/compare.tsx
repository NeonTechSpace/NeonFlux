import { createFileRoute } from '@tanstack/react-router';

import { DashboardBlueprintCompareRoute } from '../../../../components/dashboard-blueprint-compare-route.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/compare')({
    component: DashboardBlueprintCompareRoute,
});
