import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureCompareRoute } from '../../../../components/dashboard-structure-compare-route.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/compare')({
    component: DashboardStructureCompareRoute,
});
