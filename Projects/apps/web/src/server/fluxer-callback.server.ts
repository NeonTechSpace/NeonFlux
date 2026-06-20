import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';
import { exchangeFluxerAuthorizationCode } from '@neonflux/fluxer/oauth';
import type { FluxerOAuthFetch, FluxerOAuthTokenExchangeError } from '@neonflux/fluxer/oauth';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { createClearFluxerOAuthStateCookie, validateFluxerOAuthCallbackState } from './oauth-state.js';

type HandleFluxerCallbackRequestOptions = {
    env?: NodeJS.ProcessEnv;
    fetch?: FluxerOAuthFetch;
};

export async function handleFluxerCallbackRequest(
    request: Request,
    options: HandleFluxerCallbackRequestOptions = {}
): Promise<Response> {
    const config = loadConfig(options.env);
    const stateResult = validateFluxerOAuthCallbackState({
        request,
        url: new URL(request.url),
    });
    const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Set-Cookie': createClearFluxerOAuthStateCookie(config.appEnv),
    };

    if (stateResult.isErr()) {
        return new Response('Invalid Fluxer OAuth callback.', {
            status: 400,
            headers,
        });
    }

    const appId = requireConfigValue(config.fluxerAppId, 'FLUXER_APP_ID');
    const clientSecret = requireConfigValue(config.fluxerClientSecret, 'FLUXER_CLIENT_SECRET');
    const redirectUrl = requireConfigValue(config.fluxerOauthRedirectUrl, 'FLUXER_OAUTH_REDIRECT_URL');
    const tokenResult = await exchangeFluxerAuthorizationCode({
        appId,
        clientSecret,
        code: stateResult.value.code,
        redirectUrl,
        ...(options.fetch ? { fetch: options.fetch } : {}),
    });

    if (tokenResult.isErr()) {
        return new Response('Fluxer OAuth token exchange failed.', {
            status: getTokenExchangeFailureStatus(tokenResult.error),
            headers,
        });
    }

    const currentUserResult = await getFluxerCurrentUser({
        accessToken: tokenResult.value.accessToken,
        ...(options.fetch ? { fetch: options.fetch } : {}),
    });

    if (currentUserResult.isErr()) {
        return new Response('Fluxer OAuth user lookup failed.', {
            status: 502,
            headers,
        });
    }

    return new Response('Fluxer OAuth current user validated.', {
        status: 200,
        headers,
    });
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

function getTokenExchangeFailureStatus(error: FluxerOAuthTokenExchangeError): number {
    switch (error.type) {
        case 'missing-input':
        case 'request-failed':
            return 400;

        case 'invalid-response':
        case 'network-error':
            return 502;
    }
}
