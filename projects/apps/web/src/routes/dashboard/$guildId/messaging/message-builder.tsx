import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildMessageBuilderRoute } from '../../../../components/dashboard-guild-message-builder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/messaging/message-builder')({
    component: DashboardGuildMessageBuilderRoute,
});
