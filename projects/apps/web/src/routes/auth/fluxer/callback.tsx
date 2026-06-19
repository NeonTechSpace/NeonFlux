import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/auth/fluxer/callback');

const handleFluxerCallback = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleFluxerCallbackRequest } = await import('../../../server/fluxer-callback.server.js');

    return handleFluxerCallbackRequest(request);
});

export const fluxerCallbackRouteOptions = {
    server: {
        handlers: {
            GET: handleFluxerCallback,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(fluxerCallbackRouteOptions);
