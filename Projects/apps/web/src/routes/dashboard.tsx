import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/dashboard');

const handleDashboard = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleDashboardRequest } = await import('../server/dashboard.server.js');

    return handleDashboardRequest(request);
});

export const dashboardRouteOptions = {
    server: {
        handlers: {
            GET: handleDashboard,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardRouteOptions);
