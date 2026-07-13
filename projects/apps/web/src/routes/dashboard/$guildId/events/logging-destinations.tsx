import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/events/logging-destinations')({
    component: () => <DashboardPlaceholderRoute categoryId='events' itemId='logging-destinations' />,
});
