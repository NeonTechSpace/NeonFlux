import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureRunsRoute } from '../../../../components/dashboard-structure-runs-route.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/runs')({ component: DashboardStructureRunsRoute });
