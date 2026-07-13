import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/logging')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/events/logging-destinations',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
