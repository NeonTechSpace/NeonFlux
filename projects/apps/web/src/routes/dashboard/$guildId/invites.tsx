import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/invites');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/insights/invite-tracker',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
