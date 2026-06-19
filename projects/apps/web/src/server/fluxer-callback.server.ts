import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';

import { createClearFluxerOAuthStateCookie, validateFluxerOAuthCallbackState } from './oauth-state.js';

export function handleFluxerCallbackRequest(request: Request): Response {
    const config = loadConfig();
    const result = validateFluxerOAuthCallbackState({
        request,
        url: new URL(request.url),
    });
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Set-Cookie': createClearFluxerOAuthStateCookie(config.appEnv),
    };

    if (result.isErr()) {
        return new Response('Invalid Fluxer OAuth callback.', {
            status: 400,
            headers,
        });
    }

    return new Response('Fluxer OAuth callback state validated.', {
        status: 200,
        headers,
    });
}
