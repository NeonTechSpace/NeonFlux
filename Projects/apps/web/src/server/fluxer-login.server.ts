import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { buildFluxerAuthorizeUrl } from '@neonflux/fluxer/oauth';

import { createFluxerOAuthState, createFluxerOAuthStateCookie } from './oauth-state.js';

export function handleFluxerLoginRequest(): Response {
    const config = loadWebConfig();
    const appId = requireConfigValue(config.fluxerAppId, 'FLUXER_APP_ID');
    const redirectUrl = requireConfigValue(config.fluxerOauthRedirectUrl, 'FLUXER_OAUTH_REDIRECT_URL');
    const state = createFluxerOAuthState();
    const authorizeUrl = buildFluxerAuthorizeUrl({
        appId,
        redirectUrl,
        scopes: ['identify', 'guilds'],
        state,
    });

    return new Response(null, {
        status: 302,
        headers: {
            Location: authorizeUrl,
            'Set-Cookie': createFluxerOAuthStateCookie(state, config.appEnv),
        },
    });
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}
