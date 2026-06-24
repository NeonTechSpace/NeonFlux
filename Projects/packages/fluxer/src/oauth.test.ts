import { describe, expect, it } from 'vitest';

import {
    buildFluxerAuthorizeUrl,
    exchangeFluxerAuthorizationCode,
    FLUXER_OAUTH_TOKEN_URL,
    refreshFluxerOAuthToken,
    type FluxerOAuthFetch,
} from './oauth.js';

describe('buildFluxerAuthorizeUrl', () => {
    it('builds the login URL', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: '1517169145576165376',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify', 'guilds'],
            })
        ).toBe(
            'https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=identify+guilds&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Ffluxer%2Fcallback&response_type=code'
        );
    });

    it('encodes redirect URLs', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback?next=/dashboard guilds',
                scopes: ['identify'],
            })
        ).toContain(
            'redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Ffluxer%2Fcallback%3Fnext%3D%2Fdashboard+guilds'
        );
    });

    it('preserves scope order', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['guilds', 'identify', 'bot'],
            })
        ).toContain('scope=guilds+identify+bot');
    });

    it('builds a URL with state', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify', 'guilds'],
                state: 'oauth-state',
            })
        ).toContain('state=oauth-state');
    });

    it('encodes state', () => {
        expect(
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify'],
                state: 'state with symbols /+=',
            })
        ).toContain('state=state+with+symbols+%2F%2B%3D');
    });

    it('throws for empty app id', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: ' ',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify'],
            })
        ).toThrow('appId is required');
    });

    it('throws for empty redirect URL', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: ' ',
                scopes: ['identify'],
            })
        ).toThrow('redirectUrl is required');
    });

    it('throws for empty scopes', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: [],
            })
        ).toThrow('scopes is required');
    });

    it('throws for empty state when provided', () => {
        expect(() =>
            buildFluxerAuthorizeUrl({
                appId: 'app-id',
                redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
                scopes: ['identify'],
                state: ' ',
            })
        ).toThrow('state is required');
    });
});

describe('exchangeFluxerAuthorizationCode', () => {
    it('exchanges an authorization code for normalized token data', async () => {
        let capturedInput: string | URL | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch: FluxerOAuthFetch = (input, init) => {
            capturedInput = input;
            capturedInit = init;

            return Promise.resolve(
                jsonResponse({
                    access_token: 'access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    refresh_token: 'refresh-token',
                    scope: 'identify guilds',
                })
            );
        };

        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: testFetch,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            accessToken: 'access-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshToken: 'refresh-token',
            scope: 'identify guilds',
        });
        expect(capturedInput).toBe(FLUXER_OAUTH_TOKEN_URL);
        expect(capturedInit?.method).toBe('POST');

        const body = capturedInit?.body;

        if (!(body instanceof FormData)) {
            throw new Error('Expected OAuth token request body to be FormData.');
        }

        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('authorization-code');
        expect(body.get('redirect_uri')).toBe('http://localhost:3000/auth/fluxer/callback');
        expect(body.get('client_id')).toBe('app-id');
        expect(body.get('client_secret')).toBe('client-secret');
    });

    it('fails when app id is missing', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: ' ',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'appId' });
    });

    it('fails when client secret is missing', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: ' ',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'clientSecret' });
    });

    it('fails when code is missing', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: ' ',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'code' });
    });

    it('fails when redirect URL is missing', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'redirectUrl' });
    });

    it('returns request-failed for non-2xx responses', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: () =>
                Promise.resolve(jsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' })),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'request-failed',
            status: 400,
            statusText: 'Bad Request',
        });
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: () => Promise.resolve(new Response('not-json')),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for missing token response fields', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: () =>
                Promise.resolve(
                    jsonResponse({
                        access_token: 'access-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                        scope: 'identify guilds',
                    })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for invalid token expiration values', async () => {
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
            fetch: () =>
                Promise.resolve(
                    jsonResponse({
                        access_token: 'access-token',
                        token_type: 'Bearer',
                        expires_in: -1,
                        refresh_token: 'refresh-token',
                        scope: 'identify guilds',
                    })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

describe('refreshFluxerOAuthToken', () => {
    it('refreshes a token set with normalized token data', async () => {
        let capturedInput: string | URL | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch: FluxerOAuthFetch = (input, init) => {
            capturedInput = input;
            capturedInit = init;

            return Promise.resolve(
                jsonResponse({
                    access_token: 'new-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    refresh_token: 'new-refresh-token',
                    scope: 'identify guilds',
                })
            );
        };

        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'old-refresh-token',
            fetch: testFetch,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshToken: 'new-refresh-token',
            scope: 'identify guilds',
        });
        expect(capturedInput).toBe(FLUXER_OAUTH_TOKEN_URL);
        expect(capturedInit?.method).toBe('POST');

        const body = capturedInit?.body;

        if (!(body instanceof FormData)) {
            throw new Error('Expected OAuth refresh request body to be FormData.');
        }

        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('old-refresh-token');
        expect(body.get('client_id')).toBe('app-id');
        expect(body.get('client_secret')).toBe('client-secret');
        expect(body.get('code')).toBeNull();
        expect(body.get('redirect_uri')).toBeNull();
    });

    it('fails when app id is missing', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: ' ',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'appId' });
    });

    it('fails when client secret is missing', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: ' ',
            refreshToken: 'refresh-token',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'clientSecret' });
    });

    it('fails when refresh token is missing', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'refreshToken' });
    });

    it('returns request-failed for non-2xx responses', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            fetch: () =>
                Promise.resolve(jsonResponse({ error: 'invalid_grant' }, { status: 401, statusText: 'Unauthorized' })),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'request-failed',
            status: 401,
            statusText: 'Unauthorized',
        });
    });

    it('returns network-error for fetch failures', async () => {
        const networkError = new Error('Network unavailable.');
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            fetch: () => Promise.reject(networkError),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'network-error', error: networkError });
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            fetch: () => Promise.resolve(new Response('not-json')),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for malformed token responses', async () => {
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            fetch: () =>
                Promise.resolve(
                    jsonResponse({
                        access_token: 'access-token',
                        token_type: 'Bearer',
                        refresh_token: 'refresh-token',
                        scope: 'identify guilds',
                    })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
        },
        ...init,
    });
}

function createUnusedFetch(): FluxerOAuthFetch {
    return () => Promise.reject(new Error('Fetch should not be called.'));
}
