import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/.well-known/jwks.json');

const handleJwks = createServerOnlyFn(async (): Promise<Response> => {
    const { handleConvexJwksRequest } = await import('../server/convex-auth.server.js');

    return handleConvexJwksRequest();
});

const routeOptions = {
    server: {
        handlers: {
            GET: handleJwks,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(routeOptions);
