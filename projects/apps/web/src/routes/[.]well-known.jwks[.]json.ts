import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const handleJwks = createServerOnlyFn(async (): Promise<Response> => {
    const { handleConvexJwksRequest } = await import('../server/convex-auth.server.js');

    return handleConvexJwksRequest();
});

export const Route = createFileRoute('/.well-known/jwks.json')({
    server: {
        handlers: {
            GET: handleJwks,
        },
    },
});
