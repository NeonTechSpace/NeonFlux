import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildAuditCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/audit');

export const Route = createRoute({
    component: DashboardGuildAuditRoute,
});

function DashboardGuildAuditRoute() {
    return <DashboardGuildAuditCategory />;
}
