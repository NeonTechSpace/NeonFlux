import '@tanstack/react-start/server-only';

import { randomBytes } from 'node:crypto';

import type { AppEnv } from '@neonflux/config';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export const FLUXER_OAUTH_STATE_COOKIE_NAME = 'neonflux_fluxer_oauth_state';

const oauthStateByteLength = 32;
const oauthStateCookiePath = '/auth/fluxer';
const oauthStateMaxAgeSeconds = 10 * 60;

export type FluxerOAuthCallbackStateError =
    | 'missing-code'
    | 'missing-callback-state'
    | 'missing-cookie-state'
    | 'state-mismatch';

export type FluxerOAuthCallbackState = {
    code: string;
    state: string;
};

export type ValidateFluxerOAuthCallbackStateInput = {
    request: Request;
    url: URL;
};

export function createFluxerOAuthState(): string {
    return randomBytes(oauthStateByteLength).toString('base64url');
}

export function createFluxerOAuthStateCookie(state: string, appEnv: AppEnv): string {
    return createFluxerOAuthStateCookieHeader(state, appEnv, oauthStateMaxAgeSeconds);
}

export function readFluxerOAuthStateCookie(request: Request): string | undefined {
    const cookieHeader = request.headers.get('Cookie');

    if (!cookieHeader) {
        return undefined;
    }

    for (const cookie of cookieHeader.split(';')) {
        const [rawName, ...rawValueParts] = cookie.trim().split('=');

        if (rawName !== FLUXER_OAUTH_STATE_COOKIE_NAME) {
            continue;
        }

        const rawValue = rawValueParts.join('=');

        if (!rawValue) {
            return undefined;
        }

        try {
            return decodeURIComponent(rawValue);
        } catch {
            return undefined;
        }
    }

    return undefined;
}

export function createClearFluxerOAuthStateCookie(appEnv: AppEnv): string {
    return createFluxerOAuthStateCookieHeader('', appEnv, 0);
}

export function validateFluxerOAuthCallbackState({
    request,
    url,
}: ValidateFluxerOAuthCallbackStateInput): Result<FluxerOAuthCallbackState, FluxerOAuthCallbackStateError> {
    const code = url.searchParams.get('code')?.trim();
    const callbackState = url.searchParams.get('state');
    const cookieState = readFluxerOAuthStateCookie(request);

    if (!code) {
        return err('missing-code');
    }

    if (!callbackState || callbackState.trim().length === 0) {
        return err('missing-callback-state');
    }

    if (!cookieState || cookieState.trim().length === 0) {
        return err('missing-cookie-state');
    }

    if (callbackState !== cookieState) {
        return err('state-mismatch');
    }

    return ok({ code, state: callbackState });
}

function createFluxerOAuthStateCookieHeader(state: string, appEnv: AppEnv, maxAgeSeconds: number): string {
    const cookie = [
        `${FLUXER_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
        'HttpOnly',
        'SameSite=Lax',
        `Path=${oauthStateCookiePath}`,
        `Max-Age=${maxAgeSeconds}`,
    ];

    if (appEnv === 'production') {
        cookie.push('Secure');
    }

    return cookie.join('; ');
}
