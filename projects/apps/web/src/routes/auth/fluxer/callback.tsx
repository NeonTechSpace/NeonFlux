import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const handleFluxerCallback = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleFluxerCallbackRequest } = await import('../../../server/fluxer-callback.server.js');

    return handleFluxerCallbackRequest(request);
});

export const Route = createFileRoute('/auth/fluxer/callback')({
    server: {
        handlers: {
            GET: handleFluxerCallback,
        },
    },
});
