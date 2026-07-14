import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildAuditEventsRoute } from '../../../../components/dashboard-guild-audit-events-route.js';

export const Route = createFileRoute('/dashboard/$guildId/events/audit-events')({
    component: DashboardGuildAuditEventsRoute,
});
