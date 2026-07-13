import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/audit')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/events/audit-events',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
