import { Buffer } from 'node:buffer';

import { createWebSession, upsertFluxerOAuthTokenSet } from '@neonflux/db';
import type { FluxerOAuthTokenRecord, WebSessionRecord } from '@neonflux/db';
import { FLUXER_OAUTH_TOKEN_URL } from '@neonflux/fluxer/oauth';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleFluxerCallbackRequest } from './fluxer-callback.server.js';
import { decryptFluxerToken } from './fluxer-token-crypto.js';
import type { EncryptedFluxerToken } from './fluxer-token-crypto.js';
import { FLUXER_OAUTH_STATE_COOKIE_NAME } from './oauth-state.js';
import { readSessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';

const sessionSecret = 'session-secret';
const tokenEncryptionKey = Buffer.alloc(32, 1).toString('base64url');
const frozenNow = new Date('2026-06-21T00:00:00.000Z');
const expectedExpiresAt = new Date('2026-06-28T00:00:00.000Z');
const expectedAccessTokenExpiresAt = new Date('2026-06-21T01:00:00.000Z');
const currentUserUrl = 'https://api.fluxer.app/v1/oauth2/userinfo';
const currentUserGuildsUrl = 'https://api.fluxer.app/v1/users/@me/guilds';

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('@neonflux/db', () => ({
    createWebSession: vi.fn(),
    upsertFluxerOAuthTokenSet: vi.fn(),
}));

describe('handleFluxerCallbackRequest', () => {
    beforeEach(() => {
        vi.mocked(createWebSession).mockImplementation((_db, input) =>
            Promise.resolve(
                ok({
                    id: input.sessionId,
                    fluxerUserId: input.fluxerUserId,
                    createdAt: new Date(),
                    expiresAt: input.expiresAt,
                    revokedAt: null,
                } satisfies WebSessionRecord)
            )
        );
        vi.mocked(upsertFluxerOAuthTokenSet).mockImplementation((_db, input) =>
            Promise.resolve(
                ok({
                    fluxerUserId: input.fluxerUserId,
                    accessToken: input.accessToken,
                    refreshToken: input.refreshToken ?? null,
                    tokenType: input.tokenType,
                    accessTokenExpiresAt: input.accessTokenExpiresAt,
                    scopes: [...input.scopes],
                    invalidatedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                } satisfies FluxerOAuthTokenRecord)
            )
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('exchanges a valid callback code before looking up the current user and guilds', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal('fetch', createSequentialFluxerFetch(capturedRequests, createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(302);
        expect(capturedRequests).toHaveLength(3);
        expect(capturedRequests[0]?.input).toBe(FLUXER_OAUTH_TOKEN_URL);
        expect(capturedRequests[0]?.init?.method).toBe('POST');

        const body = capturedRequests[0]?.init?.body;

        if (!(body instanceof FormData)) {
            throw new Error('Expected callback token exchange body to be FormData.');
        }

        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('code-value');
        expect(body.get('redirect_uri')).toBe('http://localhost:3000/auth/fluxer/callback');
        expect(body.get('client_id')).toBe('app-id');
        expect(body.get('client_secret')).toBe('client-secret');
        expect(capturedRequests[1]?.input).toBe(currentUserUrl);
        expect(capturedRequests[1]?.init?.method).toBe('GET');
        expect(capturedRequests[1]?.init?.headers).toStrictEqual({
            Authorization: 'Bearer access-token',
        });
        expect(capturedRequests[2]?.input).toBe(currentUserGuildsUrl);
        expect(capturedRequests[2]?.init?.method).toBe('GET');
        expect(capturedRequests[2]?.init?.headers).toStrictEqual({
            Authorization: 'Bearer access-token',
        });
    });

    it('creates a DB session for the current Fluxer user', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(frozenNow);
        stubValidEnv();
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());
        const sessionInput = getCreatedSessionInput();

        expect(response.status).toBe(302);
        expect(sessionInput.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(sessionInput.fluxerUserId).toBe('1517169145576165376');
        expect(sessionInput.expiresAt).toStrictEqual(expectedExpiresAt);
    });

    it('encrypts and stores the Fluxer OAuth token set before creating a DB session', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(frozenNow);
        stubValidEnv();
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());
        const tokenInput = getPersistedTokenInput();
        const accessTokenResult = decryptFluxerToken({
            encryptedToken: tokenInput.accessToken as EncryptedFluxerToken,
            encryptionKey: tokenEncryptionKey,
        });
        const refreshTokenResult = decryptFluxerToken({
            encryptedToken: tokenInput.refreshToken as EncryptedFluxerToken,
            encryptionKey: tokenEncryptionKey,
        });

        expect(response.status).toBe(302);
        expect(tokenInput).toMatchObject({
            fluxerUserId: '1517169145576165376',
            tokenType: 'Bearer',
            accessTokenExpiresAt: expectedAccessTokenExpiresAt,
            scopes: ['identify', 'guilds'],
        });
        expect(JSON.stringify(tokenInput.accessToken)).not.toContain('access-token');
        expect(JSON.stringify(tokenInput.refreshToken)).not.toContain('refresh-token');
        expect(accessTokenResult.isOk()).toBe(true);
        expect(accessTokenResult._unsafeUnwrap()).toBe('access-token');
        expect(refreshTokenResult.isOk()).toBe(true);
        expect(refreshTokenResult._unsafeUnwrap()).toBe('refresh-token');
        expect(getCallOrder(vi.mocked(upsertFluxerOAuthTokenSet).mock.invocationCallOrder[0])).toBeLessThan(
            getCallOrder(vi.mocked(createWebSession).mock.invocationCallOrder[0])
        );
    });

    it('redirects to dashboard, clears the state cookie, and sets a readable signed session cookie when login succeeds', async () => {
        stubValidEnv();
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());
        const setCookies = getSetCookieHeaders(response);
        const sessionCookie = getSessionSetCookie(setCookies);
        const sessionCookiePair = sessionCookie.split(';')[0];
        const readSessionResult = readSessionCookie({
            request: new Request('http://localhost:3000/dashboard', {
                headers: {
                    Cookie: sessionCookiePair,
                },
            }),
            sessionSecret,
        });

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/dashboard');
        expect(await response.text()).toBe('');
        expect(setCookies).toHaveLength(2);
        expect(setCookies).toContain(createDevelopmentClearCookie());
        expect(sessionCookie).toContain(`${SESSION_COOKIE_NAME}=`);
        expect(sessionCookie).toContain('HttpOnly');
        expect(sessionCookie).toContain('SameSite=Lax');
        expect(sessionCookie).toContain('Path=/');
        expect(sessionCookie).toContain('Max-Age=604800');
        expect(readSessionResult.isOk()).toBe(true);
        expect(readSessionResult._unsafeUnwrap().sessionId).toBe(getCreatedSessionInput().sessionId);
    });

    it('does not expose token, user, guild, or session data in the success response', async () => {
        stubValidEnv();
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());
        const responseText = await response.text();

        expect(response.headers.get('Location')).toBe('/dashboard');
        expect(responseText).not.toContain('access-token');
        expect(responseText).not.toContain('refresh-token');
        expect(responseText).not.toContain('1517169145576165376');
        expect(responseText).not.toContain('neonsy');
        expect(responseText).not.toContain('guild-1');
        expect(responseText).not.toContain('NeonFlux Lab');
        expect(responseText).not.toContain(getCreatedSessionInput().sessionId);
    });

    it('returns 400, clears the state cookie, and does not call Fluxer or create a session when callback state is invalid', async () => {
        let fetchCalled = false;

        stubMinimalEnv();
        vi.stubGlobal('fetch', () => {
            fetchCalled = true;

            return Promise.resolve(createTokenResponse());
        });

        const response = await handleFluxerCallbackRequest(
            createCallbackRequest('http://localhost:3000/auth/fluxer/callback?code=code-value')
        );

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid Fluxer OAuth callback.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(fetchCalled).toBe(false);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('redirects canceled Fluxer authorization back to the homepage without creating a session', async () => {
        let fetchCalled = false;

        stubMinimalEnv();
        vi.stubGlobal('fetch', () => {
            fetchCalled = true;

            return Promise.resolve(createTokenResponse());
        });

        const response = await handleFluxerCallbackRequest(
            createCallbackRequest('http://localhost:3000/auth/fluxer/callback?error=access_denied&state=state-value')
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/');
        expect(await response.text()).toBe('');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(fetchCalled).toBe(false);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 400, clears the state cookie, and does not look up the user, guilds, or create a session when Fluxer rejects token exchange', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [
                createJsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' }),
            ])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(1);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502 and clears the state cookie when token exchange has a network failure', async () => {
        stubValidEnv();
        vi.stubGlobal('fetch', () => Promise.reject(new Error('network unavailable')));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502 and clears the state cookie when Fluxer returns an invalid token response', async () => {
        stubValidEnv();
        vi.stubGlobal('fetch', () => Promise.resolve(createJsonResponse({ access_token: 'access-token' })));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502, clears the state cookie, and does not create a session when current-user lookup is rejected', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [
                createTokenResponse(),
                createJsonResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' }),
            ])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth user lookup failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(2);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502 and clears the state cookie when current-user lookup returns an invalid response', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [
                createTokenResponse(),
                createJsonResponse({ id: 'user-id' }),
            ])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth user lookup failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(2);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502, clears the state cookie, and does not create a session when guild lookup is rejected', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [
                createTokenResponse(),
                createCurrentUserResponse(),
                createJsonResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' }),
            ])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth guild lookup failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(3);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502, clears the state cookie, and does not create a session when guild lookup has a network failure', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [createTokenResponse(), createCurrentUserResponse()])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth guild lookup failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(3);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 502, clears the state cookie, and does not create a session when guild lookup returns an invalid response', async () => {
        stubValidEnv();
        const capturedRequests: CapturedFluxerRequest[] = [];
        vi.stubGlobal(
            'fetch',
            createSequentialFluxerFetch(capturedRequests, [
                createTokenResponse(),
                createCurrentUserResponse(),
                createJsonResponse({ id: 'guild-1' }),
            ])
        );

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth guild lookup failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(capturedRequests).toHaveLength(3);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('throws clearly when required Fluxer config is missing', async () => {
        stubValidEnv();
        vi.stubEnv('FLUXER_CLIENT_SECRET', '');
        vi.stubGlobal('fetch', () => Promise.resolve(createTokenResponse()));

        await expect(handleFluxerCallbackRequest(createCallbackRequest())).rejects.toThrow(
            'FLUXER_CLIENT_SECRET is required'
        );
    });

    it('throws clearly when FLUXER_TOKEN_ENCRYPTION_KEY is missing', async () => {
        stubValidEnv();
        vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', '');
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        await expect(handleFluxerCallbackRequest(createCallbackRequest())).rejects.toThrow(
            'FLUXER_TOKEN_ENCRYPTION_KEY is required'
        );
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 500 and clears the state cookie when token encryption key is invalid', async () => {
        stubValidEnv();
        vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', 'not-a-valid-token-key');
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Fluxer OAuth token persistence failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('returns 500, clears the state cookie, and does not create a session when token persistence fails', async () => {
        stubValidEnv();
        vi.mocked(upsertFluxerOAuthTokenSet).mockResolvedValueOnce(err('database-error'));
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Fluxer OAuth token persistence failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
        expect(upsertFluxerOAuthTokenSet).toHaveBeenCalled();
        expect(createWebSession).not.toHaveBeenCalled();
    });

    it('throws clearly when SESSION_SECRET is missing', async () => {
        stubValidEnv();
        vi.stubEnv('SESSION_SECRET', '');
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        await expect(handleFluxerCallbackRequest(createCallbackRequest())).rejects.toThrow(
            'SESSION_SECRET is required'
        );
    });

    it('returns 500 and clears the state cookie when DB session creation fails', async () => {
        stubValidEnv();
        vi.mocked(createWebSession).mockResolvedValueOnce(err('database-error'));
        vi.stubGlobal('fetch', createSequentialFluxerFetch([], createSuccessfulFluxerResponses()));

        const response = await handleFluxerCallbackRequest(createCallbackRequest());

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Fluxer OAuth session creation failed.');
        expect(getSetCookieHeaders(response)).toEqual([createDevelopmentClearCookie()]);
    });
});

type CapturedFluxerRequest = {
    input: Parameters<typeof fetch>[0];
    init: Parameters<typeof fetch>[1];
};

function stubMinimalEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
}

function stubValidEnv(): void {
    stubMinimalEnv();
    vi.stubEnv('FLUXER_APP_ID', 'app-id');
    vi.stubEnv('FLUXER_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('FLUXER_OAUTH_REDIRECT_URL', 'http://localhost:3000/auth/fluxer/callback');
    vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', tokenEncryptionKey);
    vi.stubEnv('SESSION_SECRET', sessionSecret);
}

function createSequentialFluxerFetch(capturedRequests: CapturedFluxerRequest[], responses: Response[]): typeof fetch {
    return (input, init) => {
        capturedRequests.push({ input, init });

        const response = responses.shift();

        if (!response) {
            return Promise.reject(new Error('Unexpected Fluxer request.'));
        }

        return Promise.resolve(response);
    };
}

function createCallbackRequest(
    url = 'http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value',
    state = 'state-value'
): Request {
    return new Request(url, {
        headers: {
            Cookie: `${FLUXER_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
        },
    });
}

function createTokenResponse(): Response {
    return createJsonResponse({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: 'identify guilds',
    });
}

function createSuccessfulFluxerResponses(): Response[] {
    return [createTokenResponse(), createCurrentUserResponse(), createCurrentUserGuildsResponse()];
}

function createCurrentUserResponse(): Response {
    return createJsonResponse({
        id: '1517169145576165376',
        username: 'neonsy',
        discriminator: '0001',
        global_name: 'Neonsy',
        avatar: 'avatar-hash',
        bot: false,
        system: false,
    });
}

function createCurrentUserGuildsResponse(): Response {
    return createJsonResponse([
        {
            id: 'guild-1',
            name: 'NeonFlux Lab',
            permissions: '32',
        },
    ]);
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
        },
        ...init,
    });
}

function createDevelopmentClearCookie(): string {
    return `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`;
}

function getSetCookieHeaders(response: Response): string[] {
    return response.headers.getSetCookie();
}

function getSessionSetCookie(setCookies: string[]): string {
    const sessionCookie = setCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));

    if (!sessionCookie) {
        throw new Error('Expected response to set a session cookie.');
    }

    return sessionCookie;
}

function getCreatedSessionInput(): Parameters<typeof createWebSession>[1] {
    expect(createWebSession).toHaveBeenCalled();
    const call = vi.mocked(createWebSession).mock.calls[0];

    return call[1];
}

function getPersistedTokenInput(): Parameters<typeof upsertFluxerOAuthTokenSet>[1] {
    expect(upsertFluxerOAuthTokenSet).toHaveBeenCalled();
    const call = vi.mocked(upsertFluxerOAuthTokenSet).mock.calls[0];

    return call[1];
}

function getCallOrder(callOrder: number | undefined): number {
    if (callOrder === undefined) {
        throw new Error('Expected function to have been called.');
    }

    return callOrder;
}
