import { createFileRoute } from '@tanstack/react-router';

import { DashboardPlaceholderRoute } from '../../../../components/dashboard-placeholder-route.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/voice-rooms');

export const Route = createRoute({
    component: () => <DashboardPlaceholderRoute categoryId='community' itemId='voice-rooms' />,
});
