import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

import { FluxerLoginFallback } from '../../../components/fluxer-login-fallback.js';

const createRoute = createFileRoute('/auth/fluxer/login');

const handleFluxerLogin = createServerOnlyFn(async (): Promise<Response> => {
    const { handleFluxerLoginRequest } = await import('../../../server/fluxer-login.server.js');

    return handleFluxerLoginRequest();
});

const fluxerLoginRouteOptions = {
    component: FluxerLoginFallback,
    server: {
        handlers: {
            GET: handleFluxerLogin,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(fluxerLoginRouteOptions);
