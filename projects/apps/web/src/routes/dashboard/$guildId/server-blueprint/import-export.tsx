import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

const createRoute = createFileRoute('/dashboard/$guildId/server-blueprint/import-export');

export const Route = createRoute({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/structure/deploy',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
