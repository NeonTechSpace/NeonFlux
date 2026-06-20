import { FLUXER_OAUTH_TOKEN_URL } from '@neonflux/fluxer/oauth';
import type { FluxerOAuthFetch } from '@neonflux/fluxer/oauth';
import { describe, expect, it } from 'vitest';

import { handleFluxerCallbackRequest } from './fluxer-callback.server.js';
import { FLUXER_OAUTH_STATE_COOKIE_NAME } from './oauth-state.js';

const validEnv = {
    APP_ENV: 'development',
    FLUXER_APP_ID: 'app-id',
    FLUXER_CLIENT_SECRET: 'client-secret',
    FLUXER_OAUTH_REDIRECT_URL: 'http://localhost:3000/auth/fluxer/callback',
} satisfies NodeJS.ProcessEnv;

describe('handleFluxerCallbackRequest', () => {
    it('exchanges a valid callback code before looking up the current user', async () => {
        const capturedRequests: CapturedFluxerRequest[] = [];
        const fetch = createSequentialFluxerFetch(capturedRequests, [
            createTokenResponse(),
            createCurrentUserResponse(),
        ]);

        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch,
        });

        expect(response.status).toBe(200);
        expect(capturedRequests).toHaveLength(2);
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
        expect(capturedRequests[1]?.input).toBe('https://api.fluxer.app/v1/users/@me');
        expect(capturedRequests[1]?.init?.method).toBe('GET');
        expect(capturedRequests[1]?.init?.headers).toStrictEqual({
            Authorization: 'Bearer access-token',
        });
    });

    it('returns 200 and clears the state cookie when token exchange and user lookup succeed', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: createSequentialFluxerFetch([], [createTokenResponse(), createCurrentUserResponse()]),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('Fluxer OAuth current user validated.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
    });

    it('does not expose token or user data in the success response', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: createSequentialFluxerFetch([], [createTokenResponse(), createCurrentUserResponse()]),
        });

        const responseText = await response.text();

        expect(responseText).not.toContain('access-token');
        expect(responseText).not.toContain('refresh-token');
        expect(responseText).not.toContain('1517169145576165376');
        expect(responseText).not.toContain('neonsy');
    });

    it('returns 400, clears the state cookie, and does not call Fluxer when callback state is invalid', async () => {
        let fetchCalled = false;
        const response = await handleFluxerCallbackRequest(
            createCallbackRequest('http://localhost:3000/auth/fluxer/callback?code=code-value'),
            {
                env: { APP_ENV: 'development' },
                fetch: () => {
                    fetchCalled = true;
                    return Promise.resolve(createTokenResponse());
                },
            }
        );

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid Fluxer OAuth callback.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
        expect(fetchCalled).toBe(false);
    });

    it('returns 400, clears the state cookie, and does not look up the user when Fluxer rejects token exchange', async () => {
        const capturedRequests: CapturedFluxerRequest[] = [];
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: createSequentialFluxerFetch(capturedRequests, [
                createJsonResponse({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' }),
            ]),
        });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
        expect(capturedRequests).toHaveLength(1);
    });

    it('returns 502 and clears the state cookie when token exchange has a network failure', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: () => Promise.reject(new Error('network unavailable')),
        });

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
    });

    it('returns 502 and clears the state cookie when Fluxer returns an invalid token response', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: () => Promise.resolve(createJsonResponse({ access_token: 'access-token' })),
        });

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth token exchange failed.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
    });

    it('returns 502 and clears the state cookie when current-user lookup is rejected', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: createSequentialFluxerFetch(
                [],
                [
                    createTokenResponse(),
                    createJsonResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' }),
                ]
            ),
        });

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth user lookup failed.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
    });

    it('returns 502 and clears the state cookie when current-user lookup returns an invalid response', async () => {
        const response = await handleFluxerCallbackRequest(createCallbackRequest(), {
            env: validEnv,
            fetch: createSequentialFluxerFetch([], [createTokenResponse(), createJsonResponse({ id: 'user-id' })]),
        });

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Fluxer OAuth user lookup failed.');
        expect(response.headers.get('Set-Cookie')).toBe(createDevelopmentClearCookie());
    });

    it('throws clearly when required Fluxer config is missing', async () => {
        await expect(
            handleFluxerCallbackRequest(createCallbackRequest(), {
                env: {
                    APP_ENV: 'development',
                    FLUXER_APP_ID: 'app-id',
                    FLUXER_OAUTH_REDIRECT_URL: 'http://localhost:3000/auth/fluxer/callback',
                },
                fetch: () => Promise.resolve(createTokenResponse()),
            })
        ).rejects.toThrow('FLUXER_CLIENT_SECRET is required');
    });
});

type CapturedFluxerRequest = {
    input: string | URL;
    init: RequestInit | undefined;
};

function createSequentialFluxerFetch(
    capturedRequests: CapturedFluxerRequest[],
    responses: Response[]
): FluxerOAuthFetch {
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
