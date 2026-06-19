import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/auth/fluxer/login');

const handleFluxerLogin = createServerOnlyFn(async (): Promise<Response> => {
    const { handleFluxerLoginRequest } = await import('../../../server/fluxer-login.server.js');

    return handleFluxerLoginRequest();
});

export const fluxerLoginRouteOptions = {
    server: {
        handlers: {
            GET: handleFluxerLogin,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(fluxerLoginRouteOptions);
