import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';
import { createWebSession as createWebSessionRecord, upsertFluxerOAuthTokenSet } from '@neonflux/db';
import type { EncryptedOAuthTokenPayload } from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import { exchangeFluxerAuthorizationCode } from '@neonflux/fluxer/oauth';
import type { FluxerOAuthTokenExchangeError } from '@neonflux/fluxer/oauth';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import { encryptFluxerToken } from './fluxer-token-crypto.js';
import { createClearFluxerOAuthStateCookie, validateFluxerOAuthCallbackState } from './oauth-state.js';
import {
    createSessionCookie,
    createSessionId as createDefaultSessionId,
    SESSION_COOKIE_MAX_AGE_SECONDS,
} from './session-cookie.js';

const dashboardPath = '/dashboard';

export async function handleFluxerCallbackRequest(request: Request): Promise<Response> {
    const config = loadConfig();
    const stateResult = validateFluxerOAuthCallbackState({
        request,
        url: new URL(request.url),
    });
    const headers = createCallbackHeaders(config.appEnv);

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
    });

    if (tokenResult.isErr()) {
        return new Response('Fluxer OAuth token exchange failed.', {
            status: getTokenExchangeFailureStatus(tokenResult.error),
            headers,
        });
    }

    const currentUserResult = await getFluxerCurrentUser({
        accessToken: tokenResult.value.accessToken,
    });

    if (currentUserResult.isErr()) {
        return new Response('Fluxer OAuth user lookup failed.', {
            status: 502,
            headers,
        });
    }

    const guildsResult = await listFluxerCurrentUserGuilds({
        accessToken: tokenResult.value.accessToken,
    });

    if (guildsResult.isErr()) {
        return new Response('Fluxer OAuth guild lookup failed.', {
            status: 502,
            headers,
        });
    }

    const now = new Date();
    const tokenEncryptionKey = requireConfigValue(config.fluxerTokenEncryptionKey, 'FLUXER_TOKEN_ENCRYPTION_KEY');
    const persistedTokenResult = await persistDefaultFluxerOAuthTokenSet({
        fluxerUserId: currentUserResult.value.id,
        accessToken: tokenResult.value.accessToken,
        refreshToken: tokenResult.value.refreshToken,
        tokenType: tokenResult.value.tokenType,
        accessTokenExpiresAt: new Date(now.getTime() + tokenResult.value.expiresIn * 1000),
        scopes: tokenResult.value.scope.split(/\s+/).filter((scope) => scope.length > 0),
        tokenEncryptionKey,
    });

    if (persistedTokenResult.isErr()) {
        return new Response('Fluxer OAuth token persistence failed.', {
            status: 500,
            headers,
        });
    }

    const sessionSecret = requireConfigValue(config.sessionSecret, 'SESSION_SECRET');
    const sessionId = createDefaultSessionId();
    const sessionCookieResult = createSessionCookie({
        sessionId,
        sessionSecret,
        appEnv: config.appEnv,
    });

    if (sessionCookieResult.isErr()) {
        return new Response('Fluxer OAuth session creation failed.', {
            status: 500,
            headers,
        });
    }

    const sessionResult = await createDefaultWebSession({
        sessionId,
        fluxerUserId: currentUserResult.value.id,
        expiresAt: new Date(now.getTime() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000),
    });

    if (sessionResult.isErr()) {
        return new Response('Fluxer OAuth session creation failed.', {
            status: 500,
            headers,
        });
    }

    headers.append('Set-Cookie', sessionCookieResult.value);
    headers.set('Location', dashboardPath);

    return new Response(null, {
        status: 302,
        headers,
    });
}

async function createDefaultWebSession(input: { sessionId: string; fluxerUserId: string; expiresAt: Date }) {
    const database = getWebDatabaseClient();

    return createWebSessionRecord(database.db, input);
}

async function persistDefaultFluxerOAuthTokenSet(input: {
    fluxerUserId: string;
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
    tokenEncryptionKey: string;
}) {
    const encryptedAccessTokenResult = encryptFluxerToken({
        token: input.accessToken,
        encryptionKey: input.tokenEncryptionKey,
    });

    if (encryptedAccessTokenResult.isErr()) {
        return encryptedAccessTokenResult;
    }

    const encryptedRefreshTokenResult = encryptFluxerToken({
        token: input.refreshToken,
        encryptionKey: input.tokenEncryptionKey,
    });

    if (encryptedRefreshTokenResult.isErr()) {
        return encryptedRefreshTokenResult;
    }

    const accessToken: EncryptedOAuthTokenPayload = encryptedAccessTokenResult.value;
    const refreshToken: EncryptedOAuthTokenPayload = encryptedRefreshTokenResult.value;
    const database = getWebDatabaseClient();

    return upsertFluxerOAuthTokenSet(database.db, {
        fluxerUserId: input.fluxerUserId,
        accessToken,
        refreshToken,
        tokenType: input.tokenType,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        scopes: input.scopes,
    });
}

function createCallbackHeaders(appEnv: 'development' | 'production'): Headers {
    const headers = new Headers({
        'Content-Type': 'text/plain; charset=utf-8',
    });

    headers.append('Set-Cookie', createClearFluxerOAuthStateCookie(appEnv));

    return headers;
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
