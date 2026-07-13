import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildAuditEventsCategory } from '../../../../components/dashboard-guild-page.js';

export const Route = createFileRoute('/dashboard/$guildId/events/audit-events')({
    component: DashboardGuildAuditEventsCategory,
});
