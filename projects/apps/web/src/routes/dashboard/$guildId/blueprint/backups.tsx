import { createFileRoute } from '@tanstack/react-router';

import { DashboardBlueprintBackupsRoute } from '../../../../components/dashboard-blueprint-backups-route.js';

export const Route = createFileRoute('/dashboard/$guildId/blueprint/backups')({
    component: DashboardBlueprintBackupsRoute,
});
