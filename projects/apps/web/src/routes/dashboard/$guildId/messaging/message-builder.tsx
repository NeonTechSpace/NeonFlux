import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildMessageBuilderCategory } from '../../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/messaging/message-builder');

export const Route = createRoute({
    component: DashboardGuildMessageBuilderCategory,
});
