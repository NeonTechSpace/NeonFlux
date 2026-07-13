import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

import { FluxerLoginFallback } from '../../../components/fluxer-login-fallback.js';

const handleFluxerLogin = createServerOnlyFn(async (): Promise<Response> => {
    const { handleFluxerLoginRequest } = await import('../../../server/fluxer-login.server.js');

    return handleFluxerLoginRequest();
});

export const Route = createFileRoute('/auth/fluxer/login')({
    component: FluxerLoginFallback,
    server: {
        handlers: {
            GET: handleFluxerLogin,
        },
    },
});
