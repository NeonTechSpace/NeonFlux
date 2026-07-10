import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildFluxerAuthorizeUrl,
    exchangeFluxerAuthorizationCode,
    FLUXER_OAUTH_TOKEN_URL,
    refreshFluxerOAuthToken,
} from './oauth.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

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
        let capturedInput: string | URL | Request | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
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
        });
        vi.stubGlobal('fetch', testFetch);

        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
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
        stubUnusedFetch();
        const result = await exchangeFluxerAuthorizationCode({
            appId: ' ',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'appId' });
    });

    it('fails when client secret is missing', async () => {
        stubUnusedFetch();
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: ' ',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'clientSecret' });
    });

    it('fails when code is missing', async () => {
        stubUnusedFetch();
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: ' ',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'code' });
    });

    it('fails when redirect URL is missing', async () => {
        stubUnusedFetch();
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'redirectUrl' });
    });

    it('returns request-failed for non-2xx responses', async () => {
        stubFetch(jsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' }));
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'request-failed',
            status: 400,
            statusText: 'Bad Request',
        });
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        stubFetch(new Response('not-json'));
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for missing token response fields', async () => {
        stubFetch(
            jsonResponse({
                access_token: 'access-token',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'identify guilds',
            })
        );
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for invalid token expiration values', async () => {
        stubFetch(
            jsonResponse({
                access_token: 'access-token',
                token_type: 'Bearer',
                expires_in: -1,
                refresh_token: 'refresh-token',
                scope: 'identify guilds',
            })
        );
        const result = await exchangeFluxerAuthorizationCode({
            appId: 'app-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            redirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

describe('refreshFluxerOAuthToken', () => {
    it('refreshes a token set with normalized token data', async () => {
        let capturedInput: string | URL | Request | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
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
        });
        vi.stubGlobal('fetch', testFetch);

        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'old-refresh-token',
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
        stubUnusedFetch();
        const result = await refreshFluxerOAuthToken({
            appId: ' ',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'appId' });
    });

    it('fails when client secret is missing', async () => {
        stubUnusedFetch();
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: ' ',
            refreshToken: 'refresh-token',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'clientSecret' });
    });

    it('fails when refresh token is missing', async () => {
        stubUnusedFetch();
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'refreshToken' });
    });

    it('classifies a parsed invalid_grant response as terminal', async () => {
        const fetch = stubFetch(jsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' }));
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            errorCode: 'invalid_grant',
            status: 400,
            type: 'terminal-response',
        });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('keeps non-terminal provider rejections distinct from invalid credentials', async () => {
        stubFetch(jsonResponse({ error: 'invalid_client' }, { status: 401, statusText: 'Unauthorized' }));
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({
            status: 401,
            statusText: 'Unauthorized',
            type: 'request-failed',
        });
    });

    it('retries network failures a bounded number of times without surfacing error details', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => Promise.reject(new Error('Network unavailable with secret details.')));
        vi.stubGlobal('fetch', fetch);

        const resultPromise = refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'network-error' });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('does not treat invalid_grant after an ambiguous network attempt as terminal', async () => {
        vi.useFakeTimers();
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error('Response lost after provider processing.'))
            .mockResolvedValueOnce(
                jsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' })
            );
        vi.stubGlobal('fetch', fetch);

        const resultPromise = refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'ambiguous-response' });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After before retrying a rate-limited refresh', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(
                    { error: 'rate_limited' },
                    { headers: { 'Retry-After': '2' }, status: 429, statusText: 'Too Many Requests' }
                )
            )
            .mockResolvedValueOnce(createSuccessfulTokenResponse());
        vi.stubGlobal('fetch', fetch);

        const resultPromise = refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.isOk()).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(Date.now()).toBe(Date.parse('2026-07-10T08:00:02.000Z'));
    });

    it('returns a transient response after bounded 5xx retries', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() =>
            Promise.resolve(jsonResponse({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' }))
        );
        vi.stubGlobal('fetch', fetch);

        const resultPromise = refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result._unsafeUnwrapErr()).toStrictEqual({
            retryAfterMs: 1_000,
            status: 503,
            statusText: 'Unavailable',
            type: 'transient-response',
        });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        const fetch = stubFetch(new Response('not-json'));
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('returns invalid-response for malformed token responses', async () => {
        const fetch = stubFetch(
            jsonResponse({
                access_token: 'access-token',
                token_type: 'Bearer',
                refresh_token: 'refresh-token',
                scope: 'identify guilds',
            })
        );
        const result = await refreshFluxerOAuthToken({
            appId: 'app-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
        expect(fetch).toHaveBeenCalledOnce();
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

function createSuccessfulTokenResponse(): Response {
    return jsonResponse({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        scope: 'identify guilds',
    });
}

function stubFetch(response: Response) {
    const fetch = vi.fn(() => Promise.resolve(response));

    vi.stubGlobal('fetch', fetch);

    return fetch;
}

function stubUnusedFetch(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('Fetch should not be called.')))
    );
}
