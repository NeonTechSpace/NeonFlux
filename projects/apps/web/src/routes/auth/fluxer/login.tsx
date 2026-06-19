import { createFileRoute } from '@tanstack/react-router';

import { loadConfig } from '@neonflux/config';
import { buildFluxerAuthorizeUrl } from '@neonflux/fluxer/oauth';

export const Route = createFileRoute('/auth/fluxer/login')({
    server: {
        handlers: {
            GET: handleFluxerLogin,
        },
    },
});

function handleFluxerLogin(): Response {
    const config = loadConfig();
    const appId = requireConfigValue(config.fluxerAppId, 'FLUXER_APP_ID');
    const redirectUrl = requireConfigValue(config.fluxerOauthRedirectUrl, 'FLUXER_OAUTH_REDIRECT_URL');
    const authorizeUrl = buildFluxerAuthorizeUrl({
        appId,
        redirectUrl,
        scopes: ['identify', 'guilds'],
    });

    return new Response(null, {
        status: 302,
        headers: {
            Location: authorizeUrl,
        },
    });
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}
