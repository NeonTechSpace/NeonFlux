import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/auth/convex/token');

const handleConvexToken = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleConvexTokenRequest } = await import('../../../server/convex-auth.server.js');

    return handleConvexTokenRequest(request);
});

const routeOptions = {
    server: {
        handlers: {
            GET: handleConvexToken,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(routeOptions);
