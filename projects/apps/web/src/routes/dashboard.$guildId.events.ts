import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/dashboard/$guildId/events');

const handleDashboardLiveEvents = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleDashboardLiveEventsRequest } = await import('../server/dashboard-live-events.server.js');

    return handleDashboardLiveEventsRequest(request, readGuildIdFromDashboardLiveEventsUrl(request.url));
});

const dashboardLiveEventsRouteOptions = {
    server: {
        handlers: {
            GET: handleDashboardLiveEvents,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardLiveEventsRouteOptions);

function readGuildIdFromDashboardLiveEventsUrl(url: string): string {
    const pathname = new URL(url).pathname;
    const match = /^\/dashboard\/([^/]+)\/events$/.exec(pathname);

    return match ? decodeURIComponent(match[1]) : '';
}
