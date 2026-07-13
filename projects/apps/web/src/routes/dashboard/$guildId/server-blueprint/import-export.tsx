import { createFileRoute, redirect } from '@tanstack/react-router';

import { getGuildIdParam } from '../../../../server/dashboard-guild-route-data.js';

export const Route = createFileRoute('/dashboard/$guildId/server-blueprint/import-export')({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: '/dashboard/$guildId/structure/deploy',
            params: {
                guildId: getGuildIdParam(params),
            },
        });
    },
});
