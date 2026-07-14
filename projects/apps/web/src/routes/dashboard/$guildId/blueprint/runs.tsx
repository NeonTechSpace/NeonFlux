import { createFileRoute } from '@tanstack/react-router';

import { DashboardBlueprintRunsRoute } from '../../../../components/dashboard-blueprint-runs-route.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/runs')({ component: DashboardBlueprintRunsRoute });
