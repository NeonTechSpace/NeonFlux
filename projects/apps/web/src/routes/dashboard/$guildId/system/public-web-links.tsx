import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/system/public-web-links')({
    component: () => <DashboardPlaceholderRoute categoryId='system' itemId='public-web-links' />,
});
