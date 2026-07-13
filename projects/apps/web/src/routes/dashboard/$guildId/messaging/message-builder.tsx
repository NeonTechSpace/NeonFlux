import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildMessageBuilderCategory } from '../../../../components/dashboard-guild-page.js';

export const Route = createFileRoute('/dashboard/$guildId/messaging/message-builder')({
    component: DashboardGuildMessageBuilderCategory,
});
