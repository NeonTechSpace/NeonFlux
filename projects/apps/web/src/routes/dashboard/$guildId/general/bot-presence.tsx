import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/general/bot-presence')({
    component: () => <DashboardPlaceholderRoute categoryId='general' itemId='bot-presence' />,
});
