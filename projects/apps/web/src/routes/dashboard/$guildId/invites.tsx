import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/invites')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/insights/invite-tracker',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
