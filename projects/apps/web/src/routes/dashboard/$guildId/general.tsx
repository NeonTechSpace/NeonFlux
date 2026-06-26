import { createFileRoute } from '@tanstack/react-router';

import { DashboardGuildGeneralCategory } from '../../../components/dashboard-guild-page.js';

const createRoute = createFileRoute('/dashboard/$guildId/general');

export const Route = createRoute({
    component: DashboardGuildGeneralRoute,
});

function DashboardGuildGeneralRoute() {
    return <DashboardGuildGeneralCategory />;
}
