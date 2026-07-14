import { createFileRoute } from '@tanstack/react-router';

import { DashboardStructureBackupsRoute } from '../../../../components/dashboard-structure-backups-route.js';

export const Route = createFileRoute('/dashboard/$guildId/structure/backups')({
    component: DashboardStructureBackupsRoute,
});
