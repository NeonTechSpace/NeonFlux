import type { WebSessionRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLUXER_OAUTH_STATE_COOKIE_NAME } from '../../../server/oauth-state.js';
import { SESSION_COOKIE_NAME } from '../../../server/session-cookie.js';
import { fluxerCallbackRouteOptions } from './callback.js';

vi.mock('../../../server/database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();
    const { ok } = await import('neverthrow');

    return {
        ...actual,
        createWebSession: vi.fn(
            (
                _db: unknown,
                input: {
                    sessionId: string;
                    fluxerUserId: string;
                    expiresAt: Date;
                }
            ) =>
                Promise.resolve(
                    ok({
                        id: input.sessionId,
                        fluxerUserId: input.fluxerUserId,
                        createdAt: new Date('2026-06-21T00:00:00.000Z'),
                        expiresAt: input.expiresAt,
                        revokedAt: null,
                    } satisfies WebSessionRecord)
                )
        ),
    };
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('/auth/fluxer/callback', () => {
    it('redirects to dashboard and clears the state cookie when callback state is valid', async () => {
        stubFluxerEnv();
        vi.stubGlobal('fetch', createSequentialFetch([createTokenResponse(), createCurrentUserResponse()]));

        const handler = getFluxerCallbackGetHandler();
        const response = await handler({
            request: createCallbackRequest(
                'http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value',
                'state-value'
            ),
        });

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/dashboard');

        const setCookies = getSetCookieHeaders(response);

        expect(setCookies).toContain(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`
        );
        expect(setCookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
    });

    it('returns 400 and clears the state cookie when callback state is invalid', async () => {
        vi.stubEnv('APP_ENV', 'development');

        const handler = getFluxerCallbackGetHandler();
        const response = await handler({
            request: createCallbackRequest('http://localhost:3000/auth/fluxer/callback?code=code-value', 'state-value'),
        });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid Fluxer OAuth callback.');
        expect(getSetCookieHeaders(response)).toEqual([
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`,
        ]);
    });
});

function createCallbackRequest(url: string, state: string): Request {
    return new Request(url, {
        headers: {
            Cookie: `${FLUXER_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
        },
    });
}

function getFluxerCallbackGetHandler(): NonNullable<typeof fluxerCallbackRouteOptions.server.handlers>['GET'] {
    const handler = fluxerCallbackRouteOptions.server.handlers.GET;

    if (typeof handler !== 'function') {
        throw new Error('Fluxer callback GET handler is missing.');
    }

    return handler;
}

function stubFluxerEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('FLUXER_APP_ID', 'app-id');
    vi.stubEnv('FLUXER_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('FLUXER_OAUTH_REDIRECT_URL', 'http://localhost:3000/auth/fluxer/callback');
    vi.stubEnv('SESSION_SECRET', 'session-secret');
}

function createTokenResponse(): Response {
    return new Response(
        JSON.stringify({
            access_token: 'access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'refresh-token',
            scope: 'identify guilds',
        }),
        {
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );
}

function createCurrentUserResponse(): Response {
    return new Response(
        JSON.stringify({
            id: '1517169145576165376',
            username: 'neonsy',
            discriminator: '0001',
            global_name: 'Neonsy',
            avatar: 'avatar-hash',
            bot: false,
            system: false,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );
}

function createSequentialFetch(responses: Response[]): typeof fetch {
    return () => {
        const response = responses.shift();

        if (!response) {
            return Promise.reject(new Error('Unexpected Fluxer request.'));
        }

        return Promise.resolve(response);
    };
}

function getSetCookieHeaders(response: Response): string[] {
    return response.headers.getSetCookie();
}
