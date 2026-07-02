import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/community/');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/community/xp',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
