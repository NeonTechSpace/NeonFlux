import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/system/bot-installation-sync')({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='bot-installation-sync' />,
});
