import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/audit');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/events/audit-events',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
