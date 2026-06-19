import { describe, expect, it } from 'vitest';

import {
    createClearFluxerOAuthStateCookie,
    createFluxerOAuthState,
    createFluxerOAuthStateCookie,
    FLUXER_OAUTH_STATE_COOKIE_NAME,
    readFluxerOAuthStateCookie,
    validateFluxerOAuthCallbackState,
} from './oauth-state.js';

describe('createFluxerOAuthState', () => {
    it('generates a nonempty URL and cookie safe state', () => {
        const state = createFluxerOAuthState();

        expect(state).toHaveLength(43);
        expect(state).toMatch(/^[\w-]+$/);
    });
});

describe('createFluxerOAuthStateCookie', () => {
    it('creates a development state cookie without Secure', () => {
        expect(createFluxerOAuthStateCookie('state-value', 'development')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=state-value; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=600`
        );
    });

    it('creates a production state cookie with Secure', () => {
        expect(createFluxerOAuthStateCookie('state-value', 'production')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=state-value; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=600; Secure`
        );
    });
});

describe('readFluxerOAuthStateCookie', () => {
    it('reads state from a normal Cookie header', () => {
        const request = new Request('http://localhost:3000/auth/fluxer/callback', {
            headers: {
                Cookie: `other=value; ${FLUXER_OAUTH_STATE_COOKIE_NAME}=state-value`,
            },
        });

        expect(readFluxerOAuthStateCookie(request)).toBe('state-value');
    });

    it('decodes encoded cookie state', () => {
        const request = new Request('http://localhost:3000/auth/fluxer/callback', {
            headers: {
                Cookie: `${FLUXER_OAUTH_STATE_COOKIE_NAME}=state%20value%2Fencoded`,
            },
        });

        expect(readFluxerOAuthStateCookie(request)).toBe('state value/encoded');
    });

    it('returns undefined when the state cookie is absent', () => {
        const request = new Request('http://localhost:3000/auth/fluxer/callback', {
            headers: {
                Cookie: 'other=value',
            },
        });

        expect(readFluxerOAuthStateCookie(request)).toBeUndefined();
    });
});

describe('createClearFluxerOAuthStateCookie', () => {
    it('creates a development clear cookie without Secure', () => {
        expect(createClearFluxerOAuthStateCookie('development')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`
        );
    });

    it('creates a production clear cookie with Secure', () => {
        expect(createClearFluxerOAuthStateCookie('production')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0; Secure`
        );
    });
});

describe('validateFluxerOAuthCallbackState', () => {
    it('fails when code is missing', () => {
        const result = validateFluxerOAuthCallbackState({
            request: createCallbackRequest(
                'http://localhost:3000/auth/fluxer/callback?state=state-value',
                'state-value'
            ),
            url: new URL('http://localhost:3000/auth/fluxer/callback?state=state-value'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-code');
    });

    it('fails when callback state is missing', () => {
        const result = validateFluxerOAuthCallbackState({
            request: createCallbackRequest('http://localhost:3000/auth/fluxer/callback?code=code-value', 'state-value'),
            url: new URL('http://localhost:3000/auth/fluxer/callback?code=code-value'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-callback-state');
    });

    it('fails when cookie state is missing', () => {
        const url = new URL('http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value');

        const result = validateFluxerOAuthCallbackState({
            request: new Request(url),
            url,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-cookie-state');
    });

    it('fails when callback and cookie states do not match', () => {
        const url = new URL('http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value');

        const result = validateFluxerOAuthCallbackState({
            request: createCallbackRequest(url, 'other-state'),
            url,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('state-mismatch');
    });

    it('fails when callback state only matches after trimming', () => {
        const url = new URL('http://localhost:3000/auth/fluxer/callback?code=code-value&state=%20state-value');

        const result = validateFluxerOAuthCallbackState({
            request: createCallbackRequest(url, 'state-value'),
            url,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('state-mismatch');
    });

    it('succeeds when code, callback state, and cookie state are valid', () => {
        const url = new URL('http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value');

        const result = validateFluxerOAuthCallbackState({
            request: createCallbackRequest(url, 'state-value'),
            url,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            code: 'code-value',
            state: 'state-value',
        });
    });
});

function createCallbackRequest(url: string | URL, state: string): Request {
    return new Request(url, {
        headers: {
            Cookie: `${FLUXER_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
        },
    });
}
