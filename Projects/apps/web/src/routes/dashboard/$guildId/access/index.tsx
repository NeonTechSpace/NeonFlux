import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/access/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/access/command-access',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
