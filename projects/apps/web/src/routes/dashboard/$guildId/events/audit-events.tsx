import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildAuditEventsCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/events/audit-events');

export const Route = createRoute({
    component: DashboardGuildAuditEventsCategory,
});
