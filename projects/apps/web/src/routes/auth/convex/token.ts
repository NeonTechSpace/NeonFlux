import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const handleConvexToken = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleConvexTokenRequest } = await import('../../../server/convex-auth.server.js');

    return handleConvexTokenRequest(request);
});

export const Route = createFileRoute('/auth/convex/token')({
    server: {
        handlers: {
            GET: handleConvexToken,
        },
    },
});
