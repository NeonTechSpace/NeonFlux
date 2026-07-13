import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

export const Route = createFileRoute('/dashboard/$guildId/community/voice-rooms')({
    component: () => <DashboardPlaceholderRoute categoryId='community' itemId='voice-rooms' />,
});
