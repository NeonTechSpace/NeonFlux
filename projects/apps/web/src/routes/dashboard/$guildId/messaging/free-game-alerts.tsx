import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/messaging/free-game-alerts')({
    component: () => <DashboardPlaceholderRoute categoryId='messaging' itemId='free-game-alerts' />,
});
